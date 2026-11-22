import { DataSource } from 'typeorm';
import { MerchantSecurityService } from './merchant-security.service';
import { MailService } from '../auth/mail/mail.service';
import { SecurityStore } from '../../../test/helpers/security-store';
import { User } from '../users/user.entity';
import { MerchantMember } from '../team/entities/merchant-member.entity';
import { MerchantSettings } from './entities/merchant-settings.entity';
import { WebAuthnCredential } from '../auth/entities/webauthn-credential.entity';
describe('Merchant security settings', () => {
  let db: SecurityStore, service: MerchantSecurityService, mail: { sendTeamTwoFactorRequired: jest.Mock };
  beforeEach(() => {
    db = new SecurityStore();
    db.rows(User).push({ id: 'owner', twoFactorEnabled: false }, { id: 'member', email: 'member@example.com', twoFactorEnabled: false });
    db.rows(MerchantMember).push({ merchantId: 'owner', userId: 'member' });
    mail = { sendTeamTwoFactorRequired: jest.fn() };
    service = new MerchantSecurityService(db as unknown as DataSource, mail as unknown as MailService);
  });
  it('defaults to disabled policies', async () => {
    expect(await service.getSettings('owner')).toMatchObject({ require2fa: false, apiKeyInactivityDays: null });
  });
  it('refuses to enable required 2FA before the owner enrolls', async () => {
    await expect(service.upsertSettings('owner', { require2fa: true })).rejects.toThrow('owner must enable');
    expect(db.rows(MerchantSettings)).toHaveLength(0);
  });
  it('accepts owner passkeys, notifies affected members once and restricts their access', async () => {
    db.rows(WebAuthnCredential).push({ userId: 'owner' });
    await service.upsertSettings('owner', { require2fa: true });
    await service.upsertSettings('owner', { require2fa: true });
    expect(mail.sendTeamTwoFactorRequired).toHaveBeenCalledTimes(1);
    await expect(service.enforce('member', 'GET', '/v1/payments')).rejects.toThrow('Enroll');
    await expect(service.enforce('member', 'POST', '/v1/auth/2fa/enable')).resolves.toBeUndefined();
    await expect(service.enforce('member', 'POST', '/v1/auth/webauthn/registration/verify')).resolves.toBeUndefined();
    await expect(service.enforce('member', 'POST', '/v1/auth/2fa/disable')).rejects.toThrow('Enroll');
    db.rows(WebAuthnCredential).push({ userId: 'member' });
    await expect(service.enforce('member', 'GET', '/v1/payments')).resolves.toBeUndefined();
  });
  it('validates inactivity settings and supports explicitly disabling', async () => {
    await expect(service.upsertSettings('owner', { apiKeyInactivityDays: 7 })).rejects.toThrow('between 8');
    expect(await service.upsertSettings('owner', { apiKeyInactivityDays: 30 })).toMatchObject({ apiKeyInactivityDays: 30 });
    expect(await service.upsertSettings('owner', { apiKeyInactivityDays: null })).toMatchObject({ apiKeyInactivityDays: null });
  });
});
