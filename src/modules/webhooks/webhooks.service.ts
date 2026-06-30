import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { AppLogger } from '../logger/logger.service';
import { Logger } from 'pino';
import { WebhookEndpoint } from './entities/webhook-endpoint.entity';
import { WebhookDelivery, WebhookDeliveryStatus } from './entities/webhook-delivery.entity';
import { CreateWebhookEndpointDto } from './dto/create-webhook-endpoint.dto';
import { UpdateWebhookEndpointDto } from './dto/update-webhook-endpoint.dto';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class WebhooksService {
  private readonly logger: Logger;

  constructor(
    @InjectRepository(WebhookEndpoint)
    private readonly repo: Repository<WebhookEndpoint>,
    @InjectRepository(WebhookDelivery)
    private readonly deliveryRepo: Repository<WebhookDelivery>,
    @InjectQueue('webhooks') private readonly webhooksQueue: Queue,
    appLogger: AppLogger,
  ) {
    this.logger = appLogger.child({ module: WebhooksService.name });
  }

  async create(dto: CreateWebhookEndpointDto, merchantId: string): Promise<WebhookEndpoint> {
    const secret = `whsec_${randomBytes(32).toString('hex')}`;
    const endpoint = this.repo.create({ ...dto, merchantId, secret });
    const saved = await this.repo.save(endpoint);
    this.logger.info({ endpointId: saved.id, merchantId }, 'Webhook endpoint registered');
    return saved;
  }

  async findAll(merchantId: string): Promise<WebhookEndpoint[]> {
    return this.repo.find({
      where: { merchantId },
      order: { createdAt: 'DESC' },
    });
  }

  async update(
    id: string,
    dto: UpdateWebhookEndpointDto,
    merchantId: string,
  ): Promise<WebhookEndpoint> {
    const endpoint = await this.findOwned(id, merchantId);
    Object.assign(endpoint, dto);
    const updated = await this.repo.save(endpoint);
    this.logger.info({ endpointId: id, merchantId }, 'Webhook endpoint updated');
    return updated;
  }

  async remove(id: string, merchantId: string): Promise<void> {
    const endpoint = await this.findOwned(id, merchantId);
    await this.repo.remove(endpoint);
    this.logger.info({ endpointId: id, merchantId }, 'Webhook endpoint deleted');
  }

  async sendTest(id: string, merchantId: string): Promise<{ delivered: boolean; statusCode: number | null; error: string | null }> {
    const endpoint = await this.findOwned(id, merchantId);

    const payload = {
      event: 'test',
      timestamp: new Date().toISOString(),
      data: {
        message: 'This is a test event from FacilPay',
        endpointId: endpoint.id,
      },
    };

    await this.dispatchEventToEndpoint(endpoint, payload);

    return { delivered: false, statusCode: null, error: 'Queued for delivery' };
  }

  async dispatchEventToMerchant(merchantId: string, event: string, data: any): Promise<void> {
    const endpoints = await this.repo.find({ where: { merchantId } });
    const payload = {
      event,
      timestamp: new Date().toISOString(),
      data,
    };

    for (const endpoint of endpoints) {
      // Check if endpoint is enabled or filtered by event (assuming all are sent if no filter)
      await this.dispatchEventToEndpoint(endpoint, payload);
    }
  }

  async dispatchEventToEndpoint(endpoint: WebhookEndpoint, payload: any): Promise<void> {
    const delivery = this.deliveryRepo.create({
      endpointId: endpoint.id,
      payload,
      status: WebhookDeliveryStatus.PENDING,
    });
    
    const savedDelivery = await this.deliveryRepo.save(delivery);

    await this.webhooksQueue.add(
      'deliver',
      {
        deliveryId: savedDelivery.id,
        endpointId: endpoint.id,
        payload,
      },
      {
        attempts: 6, // 1 initial + 5 retries
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnComplete: true, // we store the state in the DB
        removeOnFail: false,
      }
    );
  }

  async retryFailedDelivery(deliveryId: string): Promise<void> {
    const delivery = await this.deliveryRepo.findOne({ where: { id: deliveryId } });
    if (!delivery) {
      throw new NotFoundException(`Webhook delivery ${deliveryId} not found`);
    }

    if (delivery.status !== WebhookDeliveryStatus.FAILED && delivery.status !== WebhookDeliveryStatus.DEAD_LETTER) {
      throw new ForbiddenException(`Only failed or dead-letter deliveries can be retried`);
    }

    delivery.status = WebhookDeliveryStatus.PENDING;
    await this.deliveryRepo.save(delivery);

    await this.webhooksQueue.add(
      'deliver',
      {
        deliveryId: delivery.id,
        endpointId: delivery.endpointId,
        payload: delivery.payload,
      },
      {
        attempts: 6,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnComplete: true,
        removeOnFail: false,
      }
    );
    
    this.logger.info({ deliveryId }, 'Webhook delivery scheduled for manual retry');
  }

  private async findOwned(id: string, merchantId: string): Promise<WebhookEndpoint> {
    const endpoint = await this.repo.findOneBy({ id });
    if (!endpoint) throw new NotFoundException(`Webhook endpoint ${id} not found`);
    if (endpoint.merchantId !== merchantId) throw new ForbiddenException();
    return endpoint;
  }
}
