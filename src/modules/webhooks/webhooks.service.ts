import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { AppLogger } from '../logger/logger.service';
import { Logger } from 'pino';
import { WebhookEndpoint } from './entities/webhook-endpoint.entity';
import { WebhookDelivery, WebhookDeliveryStatus } from './entities/webhook-delivery.entity';
import { getSerializer, CURRENT_API_VERSION, isValidApiVersion } from './payload-serializers';
import { CreateWebhookEndpointDto } from './dto/create-webhook-endpoint.dto';
import { UpdateWebhookEndpointDto } from './dto/update-webhook-endpoint.dto';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { EmailNotificationService } from '../notifications/email-notification.service';
import { UsersService } from '../users/users.service';
import { ReplayWebhooksDto } from './dto/replay-webhooks.dto';
import { ListWebhookDeliveriesDto } from './dto/list-webhook-deliveries.dto';
import { PaginatedResult } from '../../common/interfaces/paginated-result.interface';
import { WebhookReplay } from './entities/webhook-replay.entity';
import { validateHeaders } from './header-security';

export const DEFAULT_SECRET_GRACE_PERIOD_HOURS = 24;

export interface WebhookDeliveryView {
  id: string;
  eventType: string | null;
  status: WebhookDeliveryStatus;
  attempts: number;
  responseCode: number | null;
  latencyMs: number | null;
  responseBody: string | null;
  error: string | null;
  lastAttemptAt: Date | null;
  createdAt: Date;
}

function toDeliveryView(delivery: WebhookDelivery): WebhookDeliveryView {
  const event: unknown = delivery.payload?.event;
  return {
    id: delivery.id,
    eventType: typeof event === 'string' ? event : null,
    status: delivery.status,
    attempts: delivery.attempts,
    responseCode: delivery.lastResponseCode,
    latencyMs: delivery.latencyMs,
    responseBody: delivery.lastResponseBody,
    error: delivery.lastError,
    lastAttemptAt: delivery.lastAttemptAt,
    createdAt: delivery.createdAt,
  };
}

@Injectable()
export class WebhooksService {
  private readonly statsCache = new Map<string, { expiresAt: number; value: object }>();
  private readonly logger: Logger;
  private readonly disableFailureThreshold: number;
  private readonly disableTimeWindowHours: number;
  private readonly secretGracePeriodHours: number;

  constructor(
    @InjectRepository(WebhookEndpoint)
    private readonly repo: Repository<WebhookEndpoint>,
    @InjectRepository(WebhookDelivery)
    private readonly deliveryRepo: Repository<WebhookDelivery>,
    @InjectRepository(WebhookReplay)
    private readonly replayRepo: Repository<WebhookReplay>,
    @InjectQueue('webhooks') private readonly webhooksQueue: Queue,
    private readonly emailNotificationService: EmailNotificationService,
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
    appLogger: AppLogger,
  ) {
    this.logger = appLogger.child({ module: WebhooksService.name });
    this.disableFailureThreshold = Number(
      this.configService.get('WEBHOOK_DISABLE_FAILURE_THRESHOLD', 50),
    );
    this.disableTimeWindowHours = Number(
      this.configService.get('WEBHOOK_DISABLE_TIME_WINDOW_HOURS', 24),
    );
    const graceHours = Number(
      this.configService.get(
        'WEBHOOK_SECRET_GRACE_PERIOD_HOURS',
        DEFAULT_SECRET_GRACE_PERIOD_HOURS,
      ),
    );
    this.secretGracePeriodHours =
      Number.isFinite(graceHours) && graceHours >= 0
        ? graceHours
        : DEFAULT_SECRET_GRACE_PERIOD_HOURS;
  }

  async create(dto: CreateWebhookEndpointDto, merchantId: string): Promise<WebhookEndpoint> {
    if (dto.headers !== undefined) validateHeaders(dto.headers);
    const secret = `whsec_${randomBytes(32).toString('hex')}`;
    const apiVersion = dto.apiVersion && isValidApiVersion(dto.apiVersion)
      ? dto.apiVersion
      : CURRENT_API_VERSION;
    const endpoint = this.repo.create({ ...dto, merchantId, secret, apiVersion });
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
    if (dto.headers !== undefined) validateHeaders(dto.headers);
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

  async rotateSecret(
    id: string,
    merchantId: string,
    gracePeriodHours?: number,
  ): Promise<WebhookEndpoint> {
    const endpoint = await this.findOwned(id, merchantId);
    const graceHours = gracePeriodHours ?? this.secretGracePeriodHours;
    if (graceHours > 0) {
      // Keep the outgoing secret signing deliveries until the window closes.
      endpoint.previousSecret = endpoint.secret;
      endpoint.previousSecretExpiresAt = new Date(
        Date.now() + graceHours * 3600_000,
      );
    } else {
      endpoint.previousSecret = null;
      endpoint.previousSecretExpiresAt = null;
    }
    endpoint.secret = `whsec_${randomBytes(32).toString('hex')}`;
    const updated = await this.repo.save(endpoint);
    this.logger.info(
      { endpointId: id, merchantId, graceHours },
      'Webhook signing secret rotated',
    );
    return updated;
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

  async dispatchEventToMerchant(merchantId: string, event: string, data: any, eventId?: string): Promise<void> {
    const endpoints = await this.repo.find({ where: { merchantId, isActive: true } });

    for (const endpoint of endpoints) {
      if (endpoint.events.includes(event as any)) {
        const serializer = getSerializer(endpoint.apiVersion ?? CURRENT_API_VERSION);
        const payload = serializer.serialize(event, data, eventId);
        await this.dispatchEventToEndpoint(endpoint, payload);
      }
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
        attempts: 6,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
  }

  async recordDeliveryFailure(endpointId: string, error: string): Promise<void> {
    const endpoint = await this.repo.findOneBy({ id: endpointId });
    if (!endpoint || !endpoint.isActive) return;

    const now = new Date();
    const hoursSinceLastFailure = endpoint.lastFailureAt
      ? (now.getTime() - new Date(endpoint.lastFailureAt).getTime()) / (1000 * 60 * 60)
      : this.disableTimeWindowHours + 1;

    if (hoursSinceLastFailure > this.disableTimeWindowHours) {
      endpoint.consecutiveFailures = 0;
    }

    endpoint.consecutiveFailures += 1;
    endpoint.lastFailureAt = now;

    if (
      endpoint.consecutiveFailures >= this.disableFailureThreshold &&
      hoursSinceLastFailure <= this.disableTimeWindowHours
    ) {
      endpoint.isActive = false;
      endpoint.disabledReason = 'too_many_failures';
      await this.notifyEndpointDisabled(endpoint, error);
    }

    await this.repo.save(endpoint);
  }

  async recordDeliverySuccess(endpointId: string): Promise<void> {
    const endpoint = await this.repo.findOneBy({ id: endpointId });
    if (!endpoint) return;

    endpoint.consecutiveFailures = 0;
    endpoint.lastFailureAt = null;
    await this.repo.save(endpoint);
  }

  private async notifyEndpointDisabled(endpoint: WebhookEndpoint, lastError: string): Promise<void> {
    const appUrl = this.configService.get<string>('APP_URL', 'http://localhost:3000');
    const reenableUrl = `${appUrl}/v1/webhooks/${endpoint.id}/enable`;

    try {
      const user = await this.usersService.findOne(endpoint.merchantId);
      if (user?.email) {
        await this.emailNotificationService.sendWebhookEndpointDisabled(
          user.email,
          endpoint.url,
          endpoint.consecutiveFailures,
          lastError,
          reenableUrl,
        );
      }
    } catch (error) {
      this.logger.error(
        { endpointId: endpoint.id, merchantId: endpoint.merchantId },
        'Failed to notify merchant about disabled endpoint',
      );
    }
  }

  async reenableEndpoint(id: string, merchantId: string): Promise<WebhookEndpoint> {
    const endpoint = await this.findOwned(id, merchantId);

    if (endpoint.isActive && !endpoint.disabledReason) {
      return endpoint;
    }

    endpoint.isActive = true;
    endpoint.disabledReason = null;
    endpoint.consecutiveFailures = 0;
    endpoint.lastFailureAt = null;

    const updated = await this.repo.save(endpoint);
    this.logger.info({ endpointId: id, merchantId }, 'Webhook endpoint re-enabled');
    return updated;
  }

  async retryFailedDelivery(deliveryId: string, merchantId: string): Promise<void> {
    const delivery = await this.deliveryRepo.findOne({
      where: { id: deliveryId },
      relations: ['endpoint'],
    });
    if (!delivery) {
      throw new NotFoundException(`Webhook delivery ${deliveryId} not found`);
    }

    if (delivery.endpoint.merchantId !== merchantId) {
      throw new ForbiddenException();
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
      },
    );

    this.logger.info({ deliveryId, merchantId }, 'Webhook delivery scheduled for manual retry');
  }

  async replayEvents(
    endpointId: string,
    merchantId: string,
    dto: ReplayWebhooksDto,
  ): Promise<{ jobId: string; total: number; status: string }> {
    const endpoint = await this.findOwned(endpointId, merchantId);
    const from = new Date(dto.from);
    const to = new Date(dto.to);
    const windowMs = to.getTime() - from.getTime();
    if (!Number.isFinite(windowMs) || windowMs < 0) {
      throw new BadRequestException('from must be earlier than or equal to to');
    }
    if (windowMs > 7 * 24 * 60 * 60 * 1000) {
      throw new BadRequestException('Replay window must not exceed 7 days');
    }

    const query = this.deliveryRepo
      .createQueryBuilder('delivery')
      .where('delivery.endpointId = :endpointId', { endpointId })
      .andWhere('delivery.createdAt >= :from', { from })
      .andWhere('delivery.createdAt <= :to', { to })
      .andWhere('delivery.replayId IS NULL');
    if (dto.eventTypes?.length) {
      query.andWhere("delivery.payload->>'event' IN (:...eventTypes)", {
        eventTypes: dto.eventTypes,
      });
    }
    const sourceDeliveries = await query
      .orderBy('delivery.createdAt', 'ASC')
      .addOrderBy('delivery.id', 'ASC')
      .take(10001)
      .getMany();

    if (sourceDeliveries.length > 10000) {
      throw new BadRequestException('Replay cannot exceed 10000 events');
    }

    const replay = await this.replayRepo.save(
      this.replayRepo.create({
        endpointId,
        merchantId,
        totalEvents: sourceDeliveries.length,
        status: 'processing',
        failureReason: null,
      }),
    );

    for (const source of sourceDeliveries) {
      const replayDelivery = await this.deliveryRepo.save(
        this.deliveryRepo.create({
          endpointId,
          payload: source.payload,
          status: WebhookDeliveryStatus.PENDING,
          replayId: replay.id,
        }),
      );
      await this.webhooksQueue.add(
        'deliver',
        {
          deliveryId: replayDelivery.id,
          endpointId,
          payload: replayDelivery.payload,
        },
        {
          attempts: 6,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: true,
          removeOnFail: false,
        },
      );
    }

    return {
      jobId: replay.id,
      total: replay.totalEvents,
      status: replay.status,
    };
  }

  async getReplayProgress(
    jobId: string,
    merchantId: string,
  ): Promise<{
    jobId: string;
    status: string;
    total: number;
    pending: number;
    succeeded: number;
    failed: number;
  }> {
    const replay = await this.replayRepo.findOneBy({ id: jobId });
    if (!replay) throw new NotFoundException(`Webhook replay ${jobId} not found`);
    if (replay.merchantId !== merchantId) throw new ForbiddenException();

    const counts = await this.deliveryRepo
      .createQueryBuilder('delivery')
      .select('delivery.status', 'status')
      .addSelect('COUNT(delivery.id)', 'count')
      .where('delivery.replayId = :jobId', { jobId })
      .groupBy('delivery.status')
      .getRawMany();
    const countByStatus = new Map(
      counts.map((row) => [row.status, Number(row.count)]),
    );
    const pending = countByStatus.get(WebhookDeliveryStatus.PENDING) ?? 0;
    const failed =
      (countByStatus.get(WebhookDeliveryStatus.FAILED) ?? 0) +
      (countByStatus.get(WebhookDeliveryStatus.DEAD_LETTER) ?? 0);
    const succeeded = countByStatus.get(WebhookDeliveryStatus.SUCCESS) ?? 0;
    const deadLetter = countByStatus.get(WebhookDeliveryStatus.DEAD_LETTER) ?? 0;

    return {
      jobId,
      status:
        succeeded + deadLetter >= replay.totalEvents
          ? 'completed'
          : replay.status,
      total: replay.totalEvents,
      pending,
      succeeded,
      failed,
    };
  }

  async listDeliveries(
    id: string,
    merchantId: string,
    dto: ListWebhookDeliveriesDto,
  ): Promise<PaginatedResult<WebhookDeliveryView>> {
    await this.findOwned(id, merchantId);
    if (
      dto.from &&
      dto.to &&
      new Date(dto.from).getTime() > new Date(dto.to).getTime()
    ) {
      throw new BadRequestException('from must be earlier than or equal to to');
    }

    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const query = this.deliveryRepo
      .createQueryBuilder('delivery')
      .where('delivery.endpointId = :id', { id });
    if (dto.status) {
      query.andWhere('delivery.status = :status', { status: dto.status });
    }
    if (dto.eventType) {
      query.andWhere("delivery.payload->>'event' = :eventType", {
        eventType: dto.eventType,
      });
    }
    if (dto.from) {
      query.andWhere('delivery.createdAt >= :from', {
        from: new Date(dto.from),
      });
    }
    if (dto.to) {
      query.andWhere('delivery.createdAt <= :to', { to: new Date(dto.to) });
    }

    const [deliveries, total] = await query
      .orderBy('delivery.createdAt', 'DESC')
      .addOrderBy('delivery.id', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return {
      data: deliveries.map(toDeliveryView),
      total,
      page,
      limit,
    };
  }

  async getStats(id: string, merchantId: string) {
    await this.findOwned(id, merchantId);
    const now = Date.now();
    const cached = this.statsCache.get(id);
    if (cached && cached.expiresAt > now) return cached.value;
    const windows: Record<string, object> = {};
    for (const [window, hours] of [['24h', 24], ['7d', 168]] as const) {
      const row = await this.deliveryRepo.createQueryBuilder('delivery')
        .select('COUNT(*)', 'total')
        .addSelect("COUNT(*) FILTER (WHERE delivery.status = 'success')", 'succeeded')
        .addSelect("COUNT(*) FILTER (WHERE delivery.status IN ('failed', 'dead-letter'))", 'failures')
        .addSelect('percentile_cont(0.50) WITHIN GROUP (ORDER BY delivery.latencyMs)', 'p50')
        .addSelect('percentile_cont(0.95) WITHIN GROUP (ORDER BY delivery.latencyMs)', 'p95')
        .where('delivery.endpointId = :id', { id })
        .andWhere('delivery.lastAttemptAt >= :since', { since: new Date(now - hours * 3600000) })
        .andWhere('delivery.lastAttemptAt <= :until', { until: new Date(now) })
        .andWhere('delivery.status != :pending', { pending: WebhookDeliveryStatus.PENDING })
        .getRawOne();
      const total = Number(row?.total ?? 0);
      const succeeded = Number(row?.succeeded ?? 0);
      windows[window] = {
        total, succeeded, failures: Number(row?.failures ?? 0), successRate: total ? succeeded / total : 0,
        p50LatencyMs: row?.p50 == null ? null : Number(row.p50), p95LatencyMs: row?.p95 == null ? null : Number(row.p95),
      };
    }
    const value = { endpointId: id, windows };
    for (const [key, entry] of this.statsCache) if (entry.expiresAt <= now) this.statsCache.delete(key);
    if (this.statsCache.size >= 10000) this.statsCache.delete(this.statsCache.keys().next().value!);
    this.statsCache.set(id, { expiresAt: now + 60000, value });
    return value;
  }

  private async findOwned(id: string, merchantId: string): Promise<WebhookEndpoint> {
    const endpoint = await this.repo.findOneBy({ id });
    if (!endpoint) throw new NotFoundException(`Webhook endpoint ${id} not found`);
    if (endpoint.merchantId !== merchantId) throw new ForbiddenException();
    return endpoint;
  }
}
