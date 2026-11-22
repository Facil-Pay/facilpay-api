import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { ApiKey } from '../api-keys/api-key.entity';
import { MerchantSettings } from './entities/merchant-settings.entity';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { MerchantMember } from '../team/entities/merchant-member.entity';
import { User } from '../users/user.entity';
import { WebAuthnCredential } from '../auth/entities/webauthn-credential.entity';
import { MailService } from '../auth/mail/mail.service';
import { AuditLog } from '../audit-logs/audit-log.entity';

@Injectable()
export class MerchantSecurityService {
  constructor(private readonly db: DataSource, private readonly mail: MailService) {}

  async hasSecondFactor(userId: string): Promise<boolean> {
    const user = await this.db.getRepository(User).findOneBy({ id: userId });
    return !!user?.twoFactorEnabled || await this.db.getRepository(WebAuthnCredential).existsBy({ userId });
  }

  async requiresSecondFactor(userId: string): Promise<boolean> {
    const memberships = await this.db.getRepository(MerchantMember).findBy({ userId });
    return this.db.getRepository(MerchantSettings).existsBy({
      merchantId: In([userId, ...memberships.map(member => member.merchantId)]), require2fa: true,
    });
  }

  async enforce(userId: string, method: string, path: string): Promise<void> {
    const setupRoutes = [
      '/v1/auth/2fa/enable', '/v1/auth/2fa/verify',
      '/v1/auth/webauthn/registration/options', '/v1/auth/webauthn/registration/verify',
    ];
    if (method === 'POST' && setupRoutes.includes(path.replace(/\/$/, ''))) return;
    if (await this.requiresSecondFactor(userId) && !await this.hasSecondFactor(userId)) {
      throw new ForbiddenException({ code: 'two_factor_setup_required', message: 'Enroll in two-factor authentication to continue' });
    }
  }

  async getSettings(merchantId: string): Promise<MerchantSettings> {
    const repo = this.db.getRepository(MerchantSettings);
    return await repo.findOneBy({ merchantId }) ?? repo.create({ merchantId });
  }

  async upsertSettings(merchantId: string, dto: UpdateSettingsDto): Promise<MerchantSettings> {
    if (dto.apiKeyInactivityDays !== undefined && dto.apiKeyInactivityDays !== null &&
      (!Number.isInteger(dto.apiKeyInactivityDays) || dto.apiKeyInactivityDays < 8 || dto.apiKeyInactivityDays > 3650)) {
      throw new BadRequestException('apiKeyInactivityDays must be null or an integer between 8 and 3650');
    }
    if (dto.require2fa !== undefined && typeof dto.require2fa !== 'boolean') throw new BadRequestException('require2fa must be boolean');
    if (dto.require2fa && !await this.hasSecondFactor(merchantId)) {
      throw new BadRequestException('The owner must enable 2FA or register a passkey first');
    }
    return this.db.transaction(async manager => {
      // Serialize policy changes, including the first settings insert.
      await manager.findOneOrFail(User, { where: { id: merchantId }, lock: { mode: 'pessimistic_write' } });
      const repo = manager.getRepository(MerchantSettings);
      const settings = await repo.findOneBy({ merchantId }) ?? repo.create({ merchantId });
      const newlyRequired = dto.require2fa === true && !settings.require2fa;
      if (dto.apiKeyInactivityDays !== undefined && dto.apiKeyInactivityDays !== settings.apiKeyInactivityDays) {
        await manager.getRepository(ApiKey).update({ userId: merchantId, isActive: true }, { inactivityWarningAt: null, inactivityRevokeAt: null });
      }
      for (const field of ['remindersEnabled', 'reminderOffsets', 'timezone', 'refundApprovalThresholds', 'apiKeyInactivityDays', 'require2fa'] as const) {
        if (dto[field] !== undefined) Object.assign(settings, { [field]: dto[field] });
      }
      if (newlyRequired) {
        const members = await manager.getRepository(MerchantMember).findBy({ merchantId });
        for (const member of members) {
          if (!await this.hasSecondFactor(member.userId)) {
            const user = await manager.getRepository(User).findOneBy({ id: member.userId });
            if (user) await this.mail.sendTeamTwoFactorRequired(user.email);
          }
        }
      }
      await manager.getRepository(AuditLog).save({ actorId: merchantId, actorType: 'user', action: 'merchant.settings.updated', resourceType: 'merchant_settings', resourceId: merchantId,
        metadata: { require2fa: settings.require2fa, apiKeyInactivityDays: settings.apiKeyInactivityDays } });
      return repo.save(settings);
    });
  }
}
