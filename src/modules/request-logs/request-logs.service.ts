import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, MoreThanOrEqual, Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RequestLog } from './request-log.entity';
import { RequestLogsQueryDto } from './request-logs.dto';
import { redact } from './redact';
const RETENTION = 30 * 86_400_000;
@Injectable()
export class RequestLogsService {
  private readonly logger = new Logger(RequestLogsService.name);
  private pending = 0;
  constructor(@InjectRepository(RequestLog) private readonly repo: Repository<RequestLog>) {}

  enqueue(input: Partial<RequestLog>): void {
    if (this.pending >= 1000) { this.logger.warn('Request log queue full'); return; }
    this.pending++;
    setImmediate(() => {
      void this.persist(input).catch(() => this.logger.warn('Request log persistence failed'))
        .finally(() => { this.pending--; });
    });
  }

  async persist(input: Partial<RequestLog>): Promise<void> {
    const requestBody = redact(input.requestBody);
    const responseBody = redact(input.responseBody);
    const bounded = (body: unknown) => JSON.stringify(body).length > 32768 ? '[TRUNCATED]' : body;
    await this.repo.save(this.repo.create({ ...input, requestBody: bounded(requestBody), responseBody: bounded(responseBody) }));
  }

  async list(merchantId: string, filters: RequestLogsQueryDto) {
    if (filters.from && filters.to && new Date(filters.from) > new Date(filters.to)) throw new BadRequestException('from must precede to');
    const query = this.repo.createQueryBuilder('log')
      .where('log.merchantId = :merchantId', { merchantId })
      .andWhere('log.createdAt >= :cutoff', { cutoff: new Date(Date.now() - RETENTION) });
    for (const field of ['apiKeyId', 'method', 'path', 'status', 'idempotencyKey'] as const) {
      if (filters[field] !== undefined) query.andWhere('log.' + field + ' = :' + field, { [field]: filters[field] });
    }
    if (filters.from) query.andWhere('log.createdAt >= :from', { from: new Date(filters.from) });
    if (filters.to) query.andWhere('log.createdAt <= :to', { to: new Date(filters.to) });
    const page = Math.max(1, filters.page ?? 1), limit = Math.min(100, Math.max(1, filters.limit ?? 20));
    const [data, total] = await query.orderBy('log.createdAt', 'DESC').addOrderBy('log.id', 'DESC')
      .skip((page - 1) * limit).take(limit).getManyAndCount();
    return { data, total, page, limit };
  }

  async get(merchantId: string, id: string) {
    const log = await this.repo.findOneBy({ merchantId, id, createdAt: MoreThanOrEqual(new Date(Date.now() - RETENTION)) });
    if (!log) throw new NotFoundException('Request log not found');
    return log;
  }

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async prune(): Promise<void> { await this.repo.delete({ createdAt: LessThan(new Date(Date.now() - RETENTION)) }); }
}
