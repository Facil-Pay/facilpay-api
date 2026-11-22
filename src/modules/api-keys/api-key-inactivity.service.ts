import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { ApiKey } from './api-key.entity';
import { MerchantSettings } from '../merchants/entities/merchant-settings.entity';
import { User } from '../users/user.entity';
import { AuditLog } from '../audit-logs/audit-log.entity';
import { MailService } from '../auth/mail/mail.service';

const DAY = 86_400_000;
export function inactivityDeadline(key: Pick<ApiKey, 'lastUsedAt' | 'createdAt'>, days: number): Date {
  return new Date(new Date(key.lastUsedAt ?? key.createdAt).getTime() + days * DAY);
}

@Injectable()
export class ApiKeyInactivityService {
  private readonly logger = new Logger(ApiKeyInactivityService.name);
  constructor(private readonly db: DataSource, private readonly mail: MailService) {}

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async sweep(now = new Date()): Promise<void> {
    const policies = await this.db.getRepository(MerchantSettings).createQueryBuilder('settings')
      .where('settings.apiKeyInactivityDays IS NOT NULL').getMany();
    for (const policy of policies) {
      const keys = await this.db.getRepository(ApiKey).findBy({ userId: policy.merchantId, isActive: true });
      for (const candidate of keys) {
        try { await this.processKey(candidate.id, now); }
        catch { this.logger.error('Failed to process inactivity policy for key ' + candidate.id); }
      }
    }
  }

  async processKey(id: string, now: Date): Promise<void> {
    await this.db.transaction(async manager => {
      const repo = manager.getRepository(ApiKey);
      const key = await repo.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!key?.isActive) return;
      const policy = await manager.getRepository(MerchantSettings).findOneBy({ merchantId: key.userId });
      const days = policy?.apiKeyInactivityDays;
      if (!days) return;
      const deadline = inactivityDeadline(key, days);
      if (deadline.getTime() - now.getTime() > 7 * DAY) return;
      if (!key.inactivityWarningAt) {
        // Overdue keys and newly enabled policies still receive a full seven-day warning.
        const revokeAt = new Date(Math.max(deadline.getTime(), now.getTime() + 7 * DAY));
        const owner = await manager.getRepository(User).findOneBy({ id: key.userId });
        if (!owner) return;
        await this.mail.sendApiKeyInactivityWarning(owner.email, key.keyPrefix, revokeAt);
        key.inactivityWarningAt = now;
        key.inactivityRevokeAt = revokeAt;
        await repo.save(key);
        return;
      }
      if (!key.inactivityRevokeAt || now < key.inactivityRevokeAt || now < deadline) return;
      key.isActive = false;
      await repo.save(key);
      // The key change and audit entry commit together.
      await manager.getRepository(AuditLog).save({
        actorType: 'system', actorId: null, action: 'api_key.revoked', resourceType: 'api_key', resourceId: key.id,
        metadata: { reason: 'inactivity', merchantId: key.userId, inactivityDays: days, keyPrefix: key.keyPrefix },
      });
    });
  }
}
