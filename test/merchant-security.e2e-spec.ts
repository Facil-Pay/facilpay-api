import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { MerchantsController } from '../src/modules/merchants/merchants.controller';
import { MerchantsService } from '../src/modules/merchants/merchants.service';
import { MerchantLimitsService } from '../src/modules/merchants/merchant-limits.service';
import { MerchantSecurityService } from '../src/modules/merchants/merchant-security.service';
import { MailService } from '../src/modules/auth/mail/mail.service';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { ApiKeyInactivityService } from '../src/modules/api-keys/api-key-inactivity.service';
import { ApiKey } from '../src/modules/api-keys/api-key.entity';
import { AuditLog } from '../src/modules/audit-logs/audit-log.entity';
import { User } from '../src/modules/users/user.entity';
import { MerchantMember } from '../src/modules/team/entities/merchant-member.entity';
import { WebAuthnCredential } from '../src/modules/auth/entities/webauthn-credential.entity';
import { SecurityStore } from './helpers/security-store';

describe('Merchant security settings (HTTP)', () => {
  let app: INestApplication, db: SecurityStore, policies: MerchantSecurityService, inactivity: ApiKeyInactivityService;
  const mail = { sendTeamTwoFactorRequired: jest.fn(), sendApiKeyInactivityWarning: jest.fn() };
  beforeEach(async () => {
    jest.clearAllMocks(); db = new SecurityStore();
    db.rows(User).push(new User({ id: 'owner', email: 'owner@example.com' }), new User({ id: 'member', email: 'member@example.com' }));
    db.rows(MerchantMember).push({ merchantId: 'owner', userId: 'member' });
    const module = await Test.createTestingModule({ controllers: [MerchantsController], providers: [MerchantSecurityService, ApiKeyInactivityService,
      { provide: MerchantsService, useValue: {} }, { provide: MerchantLimitsService, useValue: {} },
      { provide: DataSource, useValue: db }, { provide: MailService, useValue: mail },
    ] }).overrideGuard(JwtAuthGuard).useValue({ canActivate: async context => {
      const req = context.switchToHttp().getRequest(); req.user = { id: req.headers.authorization === 'Bearer member' ? 'member' : 'owner' };
      await policies.enforce(req.user.id, req.method, req.path); return true;
    } }).compile();
    policies = module.get(MerchantSecurityService); inactivity = module.get(ApiKeyInactivityService);
    app = module.createNestApplication(); app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true })); await app.init();
  });
  afterEach(async () => { await app.close(); });
  it('configures inactivity and revokes a never-used key after its warning', async () => {
    await request(app.getHttpServer()).patch('/v1/merchants/me/settings').send({ apiKeyInactivityDays: 30 }).expect(200);
    const now = new Date();
    db.rows(ApiKey).push({ id: 'key', userId: 'owner', isActive: true, lastUsedAt: null, createdAt: new Date(now.getTime() - 23 * 86400000), keyPrefix: 'fp_test_1234' });
    await inactivity.processKey('key', now);
    expect(mail.sendApiKeyInactivityWarning).toHaveBeenCalledTimes(1);
    await inactivity.processKey('key', new Date(now.getTime() + 7 * 86400000));
    expect(db.rows(ApiKey)[0].isActive).toBe(false);
    expect(db.rows(AuditLog)).toContainEqual(expect.objectContaining({ action: 'api_key.revoked', actorType: 'system' }));
    const disabled = await request(app.getHttpServer()).patch('/v1/merchants/me/settings').send({ apiKeyInactivityDays: null }).expect(200);
    expect(disabled.body.apiKeyInactivityDays).toBeNull();
  });
  it('requires the owner to enroll, notifies members, and recognizes passkey enrollment', async () => {
    await request(app.getHttpServer()).patch('/v1/merchants/me/settings').send({ require2fa: true }).expect(400);
    db.rows(WebAuthnCredential).push({ userId: 'owner' });
    await request(app.getHttpServer()).patch('/v1/merchants/me/settings').send({ require2fa: true }).expect(200);
    expect(mail.sendTeamTwoFactorRequired).toHaveBeenCalledWith('member@example.com');
    await request(app.getHttpServer()).get('/v1/merchants/me/settings').set('Authorization', 'Bearer member').expect(403);
    db.rows(WebAuthnCredential).push({ userId: 'member' });
    await request(app.getHttpServer()).get('/v1/merchants/me/settings').set('Authorization', 'Bearer member').expect(200);
  });
});
