import { DataSource } from 'typeorm';
import { ApiKeyInactivityService, inactivityDeadline } from './api-key-inactivity.service';
import { ApiKey } from './api-key.entity';
import { MerchantSettings } from '../merchants/entities/merchant-settings.entity';
import { User } from '../users/user.entity';
import { AuditLog } from '../audit-logs/audit-log.entity';
import { MailService } from '../auth/mail/mail.service';

describe('API key inactivity', () => {
  const now = new Date('2026-11-22T00:00:00Z');
  let key: ApiKey, policy: Partial<MerchantSettings>, audit: { save: jest.Mock }, mail: { sendApiKeyInactivityWarning: jest.Mock }, service: ApiKeyInactivityService;
  beforeEach(() => {
    key = { id: 'key', userId: 'owner', keyPrefix: 'fp_test_1234', isActive: true, createdAt: new Date('2026-10-30T00:00:00Z'), lastUsedAt: null, inactivityWarningAt: null, inactivityRevokeAt: null } as ApiKey;
    policy = { apiKeyInactivityDays: 30 };
    audit = { save: jest.fn() };
    mail = { sendApiKeyInactivityWarning: jest.fn().mockResolvedValue(undefined) };
    const repos = new Map<any, any>([
      [ApiKey, { findOne: jest.fn(async () => key), save: jest.fn(async value => value) }],
      [MerchantSettings, { findOneBy: jest.fn(async () => policy) }],
      [User, { findOneBy: jest.fn(async () => ({ email: 'owner@example.com' })) }], [AuditLog, audit],
    ]);
    const manager = { getRepository: (entity: unknown) => repos.get(entity) };
    service = new ApiKeyInactivityService({ transaction: fn => fn(manager) } as unknown as DataSource, mail as unknown as MailService);
  });
  it('counts never-used keys from creation and used keys from last use', () => {
    expect(inactivityDeadline(key, 30).toISOString()).toBe('2026-11-29T00:00:00.000Z');
    key.lastUsedAt = now;
    expect(inactivityDeadline(key, 30).toISOString()).toBe('2026-12-22T00:00:00.000Z');
  });
  it('warns seven days before revocation and records revocation in the same transaction', async () => {
    await service.processKey(key.id, now);
    expect(mail.sendApiKeyInactivityWarning).toHaveBeenCalledTimes(1);
    expect(key.isActive).toBe(true);
    await service.processKey(key.id, new Date('2026-11-28T00:00:00Z'));
    expect(key.isActive).toBe(true);
    await service.processKey(key.id, new Date('2026-11-29T00:00:00Z'));
    expect(key.isActive).toBe(false);
    expect(audit.save).toHaveBeenCalledWith(expect.objectContaining({ actorType: 'system', action: 'api_key.revoked', resourceId: key.id }));
    expect(mail.sendApiKeyInactivityWarning).toHaveBeenCalledTimes(1);
  });
  it('gives overdue keys a full seven-day warning', async () => {
    key.createdAt = new Date('2020-01-01');
    await service.processKey(key.id, now);
    expect(key.inactivityRevokeAt?.toISOString()).toBe('2026-11-29T00:00:00.000Z');
    expect(key.isActive).toBe(true);
  });
  it('does nothing when off or recently used', async () => {
    policy.apiKeyInactivityDays = null;
    await service.processKey(key.id, now);
    policy.apiKeyInactivityDays = 30;
    key.lastUsedAt = now;
    await service.processKey(key.id, now);
    expect(mail.sendApiKeyInactivityWarning).not.toHaveBeenCalled();
    expect(audit.save).not.toHaveBeenCalled();
  });
  it('does not mark warnings when mail delivery fails', async () => {
    mail.sendApiKeyInactivityWarning.mockRejectedValueOnce(new Error('SMTP unavailable'));
    await expect(service.processKey(key.id, now)).rejects.toThrow('SMTP unavailable');
    expect(key.inactivityWarningAt).toBeNull();
    expect(key.isActive).toBe(true);
  });
});
