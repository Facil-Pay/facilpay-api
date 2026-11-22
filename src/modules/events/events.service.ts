import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, LessThanOrEqual } from 'typeorm';
import { Event } from './entities/event.entity';
import { AppLogger } from '../logger/logger.service';
import { Logger } from 'pino';
import { ConfigService } from '@nestjs/config';
import { sanitizeBody } from '../logger/logging.utils';

@Injectable()
export class EventsService {
  private readonly logger: Logger;
  private readonly retentionDays: number;

  constructor(
    @InjectRepository(Event)
    private readonly eventRepo: Repository<Event>,
    private readonly configService: ConfigService,
    appLogger: AppLogger,
  ) {
    this.logger = appLogger.child({ module: EventsService.name });
    this.retentionDays = Number(this.configService.get('EVENT_RETENTION_DAYS', 30));
  }

  emit(merchantId: string | null, type: string, payload: Record<string, any>): Event {
    const event = this.eventRepo.create({
      merchantId,
      type,
      payload: sanitizeBody(payload, 0) as Record<string, any>,
    });
    return this.eventRepo.save(event);
  }

  async findAll(
    merchantId: string,
    options: { type?: string; from?: Date; to?: Date; cursor?: string; limit?: number },
  ): Promise<{ data: Event[]; nextCursor: string | null; hasMore: boolean }> {
    const limit = options.limit || 20;
    const query = this.eventRepo.createQueryBuilder('event')
      .where('event.merchantId = :merchantId', { merchantId });

    if (options.type) {
      query.andWhere('event.type = :type', { type: options.type });
    }
    if (options.from) {
      query.andWhere('event.createdAt >= :from', { from: options.from });
    }
    if (options.to) {
      query.andWhere('event.createdAt <= :to', { to: options.to });
    }

    query.orderBy('event.createdAt', 'DESC').addOrderBy('event.id', 'DESC').take(limit + 1);

    if (options.cursor) {
      const decoded = Buffer.from(options.cursor, 'base64').toString('utf-8');
      const [cursorDate, cursorId] = decoded.split(':');
      query.andWhere(
        '(event.createdAt < :cursorDate OR (event.createdAt = :cursorDate AND event.id < :cursorId))',
        { cursorDate: new Date(cursorDate), cursorId },
      );
    }

    const events = await query.getMany();
    const hasMore = events.length > limit;
    if (hasMore) events.pop();

    const last = events[events.length - 1];
    const nextCursor = last
      ? Buffer.from(`${last.createdAt.toISOString()}:${last.id}`).toString('base64')
      : null;

    return { data: events, nextCursor, hasMore };
  }

  async findOne(id: string, merchantId: string): Promise<Event> {
    const event = await this.eventRepo.findOneBy({ id, merchantId });
    if (!event) {
      throw new NotFoundException(`Event ${id} not found`);
    }
    return event;
  }

  async cleanOldEvents(): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - this.retentionDays);
    const result = await this.eventRepo.delete({ createdAt: LessThanOrEqual(cutoff) });
    return result.affected || 0;
  }
}