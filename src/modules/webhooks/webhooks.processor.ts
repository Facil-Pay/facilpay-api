import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Job } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { AppLogger } from '../logger/logger.service';
import { Logger } from 'pino';
import { WebhooksService } from './webhooks.service';
import { WebhookDelivery, WebhookDeliveryStatus } from './entities/webhook-delivery.entity';
import { WebhookEndpoint } from './entities/webhook-endpoint.entity';
import { validateHeaders } from './header-security';
import { truncateResponseBody } from './delivery-response';
import { isPreviousSecretActive, signBody } from './webhook-signing';
import { performance } from 'perf_hooks';

@Processor('webhooks', { limiter: { max: 10, duration: 1000 } })
@Injectable()
export class WebhooksProcessor extends WorkerHost {
  private readonly logger: Logger;

  constructor(
    @InjectRepository(WebhookDelivery)
    private readonly deliveryRepo: Repository<WebhookDelivery>,
    @InjectRepository(WebhookEndpoint)
    private readonly endpointRepo: Repository<WebhookEndpoint>,
    private readonly httpService: HttpService,
    private readonly webhooksService: WebhooksService,
    appLogger: AppLogger,
  ) {
    super();
    this.logger = appLogger.child({ module: WebhooksProcessor.name });
  }

  async process(job: Job<{ deliveryId: string; endpointId: string; payload: any }>): Promise<any> {
    const { deliveryId, endpointId, payload } = job.data;
    const attempt = job.attemptsMade + 1; // 1 for first attempt, etc.

    const delivery = await this.deliveryRepo.findOne({ where: { id: deliveryId } });
    if (!delivery) {
      this.logger.error({ deliveryId }, 'Webhook delivery record not found');
      return;
    }

    const endpoint = await this.endpointRepo.findOne({ where: { id: endpointId } });
    if (!endpoint) {
      this.logger.error({ endpointId }, 'Webhook endpoint not found');
      // Set delivery status to failed
      delivery.status = WebhookDeliveryStatus.FAILED;
      delivery.lastError = 'Endpoint not found';
      delivery.attempts = attempt;
      delivery.lastAttemptAt = new Date();
      await this.deliveryRepo.save(delivery);
      return; // Stop retrying if endpoint is gone
    }

    const body = JSON.stringify(payload);
    // During a rotation grace period this carries one digest per active secret.
    const signature = signBody(body, endpoint);
    await this.dropExpiredPreviousSecret(endpoint);

    delivery.attempts = attempt;
    delivery.lastAttemptAt = new Date();

    const startedAt = performance.now();
    try {
      if (endpoint.headers) validateHeaders(endpoint.headers);
      const response = await firstValueFrom(
        this.httpService.post(endpoint.url, payload, {
          timeout: 10_000,
          maxRedirects: 0,
          headers: {
            ...endpoint.headers,
            'Content-Type': 'application/json',
            'X-FacilPay-Signature': signature,
            'X-FacilPay-Event': payload.event || 'webhook',
            'X-FacilPay-Api-Version': endpoint.apiVersion || '2026-09-01',
          },
        }),
      );

      delivery.status = WebhookDeliveryStatus.SUCCESS;
      delivery.latencyMs = Math.round(performance.now() - startedAt);
      delivery.lastResponseCode = response.status;
      delivery.lastResponseBody = truncateResponseBody(response.data);
      delivery.lastError = null;
      await this.deliveryRepo.save(delivery);

      // Reset failure counters on success
      await this.webhooksService.recordDeliverySuccess(endpointId);

      this.logger.info(
        { deliveryId, endpointId, attempt, statusCode: response.status },
        'Webhook delivered successfully',
      );

      return { success: true, statusCode: response.status };
    } catch (error: any) {
      delivery.latencyMs = Math.round(performance.now() - startedAt);
      const errorResponse = error?.response as
        | { status?: number; data?: unknown }
        | undefined;
      const statusCode = errorResponse?.status ?? null;
      const errorMsg = error instanceof Error ? error.message : String(error);

      delivery.lastResponseCode = statusCode;
      delivery.lastResponseBody = truncateResponseBody(errorResponse?.data);
      delivery.lastError = errorMsg;

      // Job options specify up to 6 attempts (initial + 5 retries)
      // Record failure for endpoint auto-disable logic
      await this.webhooksService.recordDeliveryFailure(endpointId, errorMsg);

      if (attempt >= (job.opts.attempts || 6)) {
        delivery.status = WebhookDeliveryStatus.DEAD_LETTER;
        this.logger.error(
          { deliveryId, endpointId, attempt, statusCode, error: errorMsg },
          'Webhook delivery finally failed and moved to dead-letter',
        );
      } else {
        delivery.status = WebhookDeliveryStatus.FAILED;
        this.logger.warn(
          { deliveryId, endpointId, attempt, statusCode, error: errorMsg },
          'Webhook delivery failed, will retry',
        );
      }

      await this.deliveryRepo.save(delivery);
      throw error; // Throw error to trigger BullMQ retry
    }
  }

  /** Clears a previous secret whose grace period has ended; never fails a delivery. */
  private async dropExpiredPreviousSecret(
    endpoint: WebhookEndpoint,
  ): Promise<void> {
    if (!endpoint.previousSecret || isPreviousSecretActive(endpoint)) return;
    try {
      await this.endpointRepo.update(endpoint.id, {
        previousSecret: null,
        previousSecretExpiresAt: null,
      });
    } catch {
      this.logger.warn(
        { endpointId: endpoint.id },
        'Failed to clear expired previous webhook secret',
      );
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(
      { jobId: job.id, attempt: job.attemptsMade, error: error.message },
      'Webhook job failed',
    );
  }
}
