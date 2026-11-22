import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AuditLog, ActorType } from './audit-log.entity';
import { PaginatedResult } from '../../common/interfaces/paginated-result.interface';
import { sanitizeBody } from '../logger/logging.utils';

export interface RecordAuditLogParams {
  actorId?: string | null;
  actorType: ActorType;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, any> | null;
}

@Injectable()
export class AuditLogsService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogRepository: Repository<AuditLog>,
  ) {}

  /**
   * Pass `manager` to write the log inside an existing transaction so it
   * commits or rolls back together with the audited change.
   */
  async record(
    params: RecordAuditLogParams,
    manager?: EntityManager,
  ): Promise<AuditLog> {
    const repository = manager
      ? manager.getRepository(AuditLog)
      : this.auditLogRepository;
    const log = repository.create({
      actorId: params.actorId ?? null,
      actorType: params.actorType,
      action: params.action,
      resourceType: params.resourceType,
      resourceId: params.resourceId ?? null,
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent ?? null,
      metadata: params.metadata
        ? (sanitizeBody(params.metadata, 0) as Record<string, any>)
        : null,
    });

    return repository.save(log);
  }

  async findAll(filters: {
    actorId?: string;
    actorType?: string;
    action?: string;
    resourceType?: string;
    resourceId?: string;
    ipAddress?: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
    order?: 'ASC' | 'DESC';
  }): Promise<PaginatedResult<AuditLog>> {
    const query = this.auditLogRepository.createQueryBuilder('audit_log');

    if (filters.actorId) {
      query.andWhere('audit_log.actorId = :actorId', { actorId: filters.actorId });
    }
    if (filters.actorType) {
      query.andWhere('audit_log.actorType = :actorType', { actorType: filters.actorType });
    }
    if (filters.action) {
      query.andWhere('audit_log.action = :action', { action: filters.action });
    }
    if (filters.resourceType) {
      query.andWhere('audit_log.resourceType = :resourceType', { resourceType: filters.resourceType });
    }
    if (filters.resourceId) {
      query.andWhere('audit_log.resourceId = :resourceId', { resourceId: filters.resourceId });
    }
    if (filters.ipAddress) {
      query.andWhere('audit_log.ipAddress = :ipAddress', { ipAddress: filters.ipAddress });
    }
    if (filters.from) {
      query.andWhere('audit_log.timestamp >= :from', { from: new Date(filters.from) });
    }
    if (filters.to) {
      query.andWhere('audit_log.timestamp <= :to', { to: new Date(filters.to) });
    }

    const page = filters.page || 1;
    const limit = filters.limit || 25;
    const skip = (page - 1) * limit;
    const order = filters.order || 'DESC';

    query
      .orderBy('audit_log.timestamp', order)
      .skip(skip)
      .take(limit);

    const [data, total] = await query.getManyAndCount();

    return { data, total, page, limit };
  }
}
