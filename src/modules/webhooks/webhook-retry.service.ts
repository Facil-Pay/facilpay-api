import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual } from 'typeorm';
import * as https from 'https';
import * as http from 'http';
import {
  WebhookDelivery,
  WebhookDeliveryStatus,
  WebhookEventType,
} from './webhook-delivery.entity';

const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 3600_000; // 1 hour cap

function exponentialDelay(attempt: number): number {
  const jitter = Math.random() * 1000;
  return Math.min(BASE_DELAY_MS * Math.pow(2, attempt) + jitter, MAX_DELAY_MS);
}

@Injectable()
export class WebhookRetryService {
  private readonly logger = new Logger(WebhookRetryService.name);

  constructor(
    @InjectRepository(WebhookDelivery)
    private readonly deliveryRepository: Repository<WebhookDelivery>,
  ) {}

  async schedule(
    paymentId: string,
    url: string,
    eventType: WebhookEventType,
    payload: Record<string, unknown>,
    maxAttempts = 5,
  ): Promise<WebhookDelivery> {
    const delivery = this.deliveryRepository.create({
      paymentId,
      url,
      eventType,
      payload,
      maxAttempts,
      status: WebhookDeliveryStatus.PENDING,
      nextRetryAt: new Date(),
    });
    const saved = await this.deliveryRepository.save(delivery);
    this.logger.log(`Scheduled webhook delivery ${saved.id} for ${eventType}`);
    setImmediate(() => this.attemptDelivery(saved.id));
    return saved;
  }

  async attemptDelivery(deliveryId: string): Promise<void> {
    const delivery = await this.deliveryRepository.findOneBy({ id: deliveryId });
    if (!delivery) return;

    if (
      delivery.status === WebhookDeliveryStatus.SUCCESS ||
      delivery.status === WebhookDeliveryStatus.EXHAUSTED
    ) {
      return;
    }

    delivery.attemptCount += 1;
    delivery.lastAttemptAt = new Date();

    try {
      const statusCode = await this.post(delivery.url, delivery.payload);
      delivery.lastHttpStatus = statusCode;

      if (statusCode >= 200 && statusCode < 300) {
        delivery.status = WebhookDeliveryStatus.SUCCESS;
        delivery.nextRetryAt = null;
        this.logger.log(
          `Webhook ${delivery.id} delivered (attempt ${delivery.attemptCount})`,
        );
      } else {
        throw new Error(`HTTP ${statusCode}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      delivery.lastError = message;
      this.logger.warn(
        `Webhook ${delivery.id} attempt ${delivery.attemptCount} failed: ${message}`,
      );

      if (delivery.attemptCount >= delivery.maxAttempts) {
        delivery.status = WebhookDeliveryStatus.EXHAUSTED;
        delivery.nextRetryAt = null;
        this.logger.error(
          `Webhook ${delivery.id} exhausted after ${delivery.attemptCount} attempts`,
        );
      } else {
        delivery.status = WebhookDeliveryStatus.FAILED;
        const delayMs = exponentialDelay(delivery.attemptCount);
        delivery.nextRetryAt = new Date(Date.now() + delayMs);
        this.scheduleRetry(delivery.id, delayMs);
      }
    }

    await this.deliveryRepository.save(delivery);
  }

  private scheduleRetry(deliveryId: string, delayMs: number): void {
    setTimeout(() => {
      this.attemptDelivery(deliveryId).catch((err) => {
        this.logger.error(`Retry failed for ${deliveryId}: ${err.message}`);
      });
    }, delayMs);
  }

  async retryPendingDeliveries(): Promise<void> {
    const due = await this.deliveryRepository.find({
      where: {
        status: WebhookDeliveryStatus.FAILED,
        nextRetryAt: LessThanOrEqual(new Date()),
      },
      take: 100,
    });

    for (const delivery of due) {
      await this.attemptDelivery(delivery.id);
    }
  }

  async getDeliveries(
    paymentId: string,
  ): Promise<WebhookDelivery[]> {
    return this.deliveryRepository.find({
      where: { paymentId },
      order: { createdAt: 'DESC' },
    });
  }

  private post(
    url: string,
    body: Record<string, unknown>,
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(body);
      const parsed = new URL(url);
      const isHttps = parsed.protocol === 'https:';
      const lib = isHttps ? https : http;

      const req = lib.request(
        {
          hostname: parsed.hostname,
          port: parsed.port || (isHttps ? 443 : 80),
          path: parsed.pathname + parsed.search,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data),
            'User-Agent': 'FacilPay-Webhooks/1.0',
          },
          timeout: 10_000,
        },
        (res) => resolve(res.statusCode ?? 0),
      );

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timed out after 10s'));
      });
      req.write(data);
      req.end();
    });
  }
}
