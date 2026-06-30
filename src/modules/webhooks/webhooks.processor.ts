import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Job } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { createHmac } from 'crypto';
import { AppLogger } from '../logger/logger.service';
import { Logger } from 'pino';
import { WebhookDelivery, WebhookDeliveryStatus } from './entities/webhook-delivery.entity';
import { WebhookEndpoint } from './entities/webhook-endpoint.entity';

@Processor('webhooks')
@Injectable()
export class WebhooksProcessor extends WorkerHost {
  private readonly logger: Logger;

  constructor(
    @InjectRepository(WebhookDelivery)
    private readonly deliveryRepo: Repository<WebhookDelivery>,
    @InjectRepository(WebhookEndpoint)
    private readonly endpointRepo: Repository<WebhookEndpoint>,
    private readonly httpService: HttpService,
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
    const signature = createHmac('sha256', endpoint.secret)
      .update(body)
      .digest('hex');

    delivery.attempts = attempt;
    delivery.lastAttemptAt = new Date();

    try {
      const response = await firstValueFrom(
        this.httpService.post(endpoint.url, payload, {
          timeout: 10_000,
          headers: {
            'Content-Type': 'application/json',
            'X-FacilPay-Signature': signature,
            'X-FacilPay-Event': payload.event || 'webhook',
          },
        }),
      );

      delivery.status = WebhookDeliveryStatus.SUCCESS;
      delivery.lastResponseCode = response.status;
      delivery.lastError = null;
      await this.deliveryRepo.save(delivery);

      this.logger.info(
        { deliveryId, endpointId, attempt, statusCode: response.status },
        'Webhook delivered successfully',
      );
      
      return { success: true, statusCode: response.status };
    } catch (error: any) {
      const statusCode = error?.response?.status ?? null;
      const errorMsg = error instanceof Error ? error.message : String(error);

      delivery.lastResponseCode = statusCode;
      delivery.lastError = errorMsg;

      // Job options specify up to 6 attempts (initial + 5 retries)
      if (attempt >= (job.opts.attempts || 6)) {
        delivery.status = WebhookDeliveryStatus.DEAD_LETTER;
        this.logger.error(
          { deliveryId, endpointId, attempt, statusCode, error: errorMsg },
          'Webhook delivery finally failed and moved to dead-letter',
        );
        // Here we could emit an application event about final failure if we had an event emitter
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

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(
      { jobId: job.id, attempt: job.attemptsMade, error: error.message },
      'Webhook job failed',
    );
  }
}
