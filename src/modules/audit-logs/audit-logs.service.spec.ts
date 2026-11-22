import { AuditLogsService } from './audit-logs.service';
import { ActorType, AuditLog } from './audit-log.entity';

describe('AuditLogsService', () => {
  const createHarness = () => {
    const query = {
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn(),
    };
    const auditLogRepository = {
      create: jest.fn((data) => data),
      save: jest.fn((log) => Promise.resolve(log)),
      createQueryBuilder: jest.fn(() => query),
    };
    const service = new AuditLogsService(auditLogRepository as any);
    return { service, auditLogRepository, query };
  };

  it('records audit metadata with sensitive values redacted', async () => {
    const harness = createHarness();
    const params = {
      actorId: 'user-1',
      actorType: 'user' as ActorType,
      action: 'auth.login.success',
      resourceType: 'user',
      metadata: {
        email: 'user@example.com',
        password: 'plain-text-secret',
        nested: { access_token: 'access-secret', safe: 'value' },
      },
    };
    const expectedLog = {
      ...params,
      resourceId: null,
      ipAddress: null,
      userAgent: null,
      metadata: {
        email: 'user@example.com',
        password: '[REDACTED]',
        nested: { access_token: '[REDACTED]', safe: 'value' },
      },
    };

    await expect(harness.service.record(params)).resolves.toEqual(expectedLog);
    expect(harness.auditLogRepository.create).toHaveBeenCalledWith(expectedLog);
    expect(harness.auditLogRepository.save).toHaveBeenCalledWith(expectedLog);
  });

  it('filters by actor, action, and date range and returns paginated logs', async () => {
    const harness = createHarness();
    const log = { id: 'audit-1' } as AuditLog;
    harness.query.getManyAndCount.mockResolvedValue([[log], 7]);
    const from = '2026-10-01T00:00:00.000Z';
    const to = '2026-10-10T23:59:59.999Z';

    await expect(
      harness.service.findAll({
        actorId: 'user-1',
        action: 'user.updated',
        from,
        to,
        page: 2,
        limit: 3,
        order: 'ASC',
      }),
    ).resolves.toEqual({ data: [log], total: 7, page: 2, limit: 3 });

    expect(harness.query.andWhere).toHaveBeenCalledWith(
      'audit_log.actorId = :actorId',
      { actorId: 'user-1' },
    );
    expect(harness.query.andWhere).toHaveBeenCalledWith(
      'audit_log.action = :action',
      { action: 'user.updated' },
    );
    expect(harness.query.andWhere).toHaveBeenCalledWith(
      'audit_log.timestamp >= :from',
      { from: new Date(from) },
    );
    expect(harness.query.andWhere).toHaveBeenCalledWith(
      'audit_log.timestamp <= :to',
      { to: new Date(to) },
    );
    expect(harness.query.orderBy).toHaveBeenCalledWith(
      'audit_log.timestamp',
      'ASC',
    );
    expect(harness.query.skip).toHaveBeenCalledWith(3);
    expect(harness.query.take).toHaveBeenCalledWith(3);
  });
});