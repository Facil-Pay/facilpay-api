import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { inflateRawSync } from 'zlib';
import { SamlController } from '../src/modules/auth/saml.controller';
import { SamlService } from '../src/modules/auth/saml.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { SessionsService } from '../src/modules/sessions/sessions.service';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { MerchantSamlConfig } from '../src/modules/auth/entities/merchant-saml-config.entity';
import { MerchantMember, TeamRole } from '../src/modules/team/entities/merchant-member.entity';
import { User } from '../src/modules/users/user.entity';
import { MerchantSettings } from '../src/modules/merchants/entities/merchant-settings.entity';
import { Session } from '../src/modules/sessions/session.entity';
import { RefreshToken } from '../src/modules/auth/entities/refresh-token.entity';
import { SecurityStore } from './helpers/security-store';
import { mockSamlIdp } from './helpers/mock-saml-idp';

describe('SAML with a signing mock IdP (HTTP)', () => {
  const merchantId = '11111111-1111-4111-8111-111111111111';
  const base = '/v1/auth/saml/' + merchantId;
  const audience = 'https://api.example.com' + base + '/metadata';
  const callback = 'https://api.example.com' + base + '/acs';
  let app: INestApplication, db: SecurityStore, idp: ReturnType<typeof mockSamlIdp>;
  beforeAll(() => { idp = mockSamlIdp(); });
  beforeEach(async () => {
    db = new SecurityStore();
    db.rows(User).push(new User({ id: merchantId, email: 'owner@example.com', twoFactorEnabled: true, isEmailVerified: true }));
    db.rows(MerchantSamlConfig).push({ merchantId, metadataXml: idp.metadata, domain: 'example.com', requireSso: false, defaultRole: TeamRole.VIEWER });
    // Exercise the real shared completion method and sessions module service.
    const auth = Object.create(AuthService.prototype) as AuthService;
    Object.assign(auth, {
      sessionsService: new SessionsService(db.getRepository(Session), db.getRepository(RefreshToken), db.getRepository(MerchantSettings), db.getRepository(MerchantMember)),
      jwtService: new JwtService({ secret: 'test-secret', signOptions: { expiresIn: '1h' } }),
      refreshTokenRepository: db.getRepository(RefreshToken), configService: new ConfigService(),
      geoLookupService: { lookupCountry: () => null }, logger: { info: () => {} },
      auditLogsService: { record: async () => ({}) }, loginAlertsService: { sendAlertIfNeeded: async () => false },
    });
    const module = await Test.createTestingModule({ controllers: [SamlController], providers: [SamlService,
      { provide: DataSource, useValue: db }, { provide: ConfigService, useValue: new ConfigService({ SAML_PUBLIC_URL: 'https://api.example.com' }) },
      { provide: AuthService, useValue: auth },
    ] }).overrideGuard(JwtAuthGuard).useValue({ canActivate: context => { context.switchToHttp().getRequest().user = { id: merchantId }; return true; } }).compile();
    app = module.createNestApplication(); app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true })); await app.init();
  });
  afterEach(async () => { await app.close(); });
  it('accepts IdP-initiated login, provisions the default role and creates a normal session', async () => {
    const response = idp.response(audience, callback);
    const result = await request(app.getHttpServer()).post(base + '/acs').type('form').send({ SAMLResponse: response }).expect(200);
    expect(result.body.access_token).toBeTruthy(); expect(result.body.refresh_token).toBeTruthy();
    expect(db.rows(MerchantMember)).toEqual([expect.objectContaining({ merchantId, role: TeamRole.VIEWER })]);
    expect(db.rows(Session)).toEqual([expect.objectContaining({ userId: result.body.user.id, revoked: false })]);
    await request(app.getHttpServer()).post(base + '/acs').type('form').send({ SAMLResponse: response }).expect(401);
  });
  it('supports a correlated SP-initiated login', async () => {
    const start = await request(app.getHttpServer()).get(base + '/login').expect(302);
    const redirect = new URL(start.headers.location);
    const authnRequest = inflateRawSync(Buffer.from(redirect.searchParams.get('SAMLRequest')!, 'base64')).toString();
    const requestId = /ID="([^"]+)"/.exec(authnRequest)![1];
    await request(app.getHttpServer()).post(base + '/acs').type('form').send({ RelayState: redirect.searchParams.get('RelayState'),
      SAMLResponse: idp.response(audience, callback, { requestId }),
    }).expect(200);
  });
  it.each(['audience', 'expired', 'signature', 'recipient', 'domain'])('rejects invalid %s', async failure => {
    let encoded = idp.response(failure === 'audience' ? 'https://wrong.example.com' : audience,
      failure === 'recipient' ? 'https://wrong.example.com/acs' : callback,
      { expired: failure === 'expired', email: failure === 'domain' ? 'new@other.example' : undefined });
    if (failure === 'signature') encoded = Buffer.from(Buffer.from(encoded, 'base64').toString().replace('new@example.com', 'bad@example.com')).toString('base64');
    const result = await request(app.getHttpServer()).post(base + '/acs').type('form').send({ SAMLResponse: encoded });
    expect([401, 403]).toContain(result.status);
    expect(db.rows(Session)).toHaveLength(0);
  });
  it('does not link an existing unrelated account by email', async () => {
    db.rows(User).push(new User({ id: 'unrelated', email: 'new@example.com', isEmailVerified: true }));
    await request(app.getHttpServer()).post(base + '/acs').type('form').send({ SAMLResponse: idp.response(audience, callback) }).expect(403);
    expect(db.rows(MerchantMember)).toHaveLength(0);
  });
});
