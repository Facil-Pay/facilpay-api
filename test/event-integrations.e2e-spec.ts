import { Body, Controller, INestApplication, Post, UnauthorizedException, UseGuards, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import { getRepositoryToken } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'crypto';
import request from 'supertest';
import { OAuthController } from '../src/modules/auth/oauth/oauth.controller';
import { OAuthService } from '../src/modules/auth/oauth/oauth.service';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { ApiKeyAuthGuard } from '../src/modules/api-keys/api-key-auth.guard';
import { ApiKeysService } from '../src/modules/api-keys/api-keys.service';
import { RequireScope } from '../src/modules/api-keys/decorators/require-scope.decorator';
import { encryptSigningSecret, signRequest } from '../src/modules/api-keys/request-signing';
import { WebhooksController } from '../src/modules/webhooks/webhooks.controller';
import { WebhooksService } from '../src/modules/webhooks/webhooks.service';
import { HooksController } from '../src/modules/webhooks/hooks.controller';
import { HooksService } from '../src/modules/webhooks/hooks.service';
import { WebhookEndpoint } from '../src/modules/webhooks/entities/webhook-endpoint.entity';
import { WebhookDelivery } from '../src/modules/webhooks/entities/webhook-delivery.entity';
import { WebhookReplay } from '../src/modules/webhooks/entities/webhook-replay.entity';
import { EmailNotificationService } from '../src/modules/notifications/email-notification.service';
import { UsersService } from '../src/modules/users/users.service';
import { AppLogger } from '../src/modules/logger/logger.service';
import { oauthTestStore } from './support/oauth-test-store';

@Controller('v1/signing-probe')
@UseGuards(ApiKeyAuthGuard)
class SigningProbe {
  @Post() @RequireScope('webhooks:read')
  echo(@Body() body: unknown) { return body; }
}

describe('Event integrations HTTP endpoints (e2e)', () => {
  let app: INestApplication;
  const merchantId = randomUUID();
  const endpoints: any[] = [];
  const queue = { add: jest.fn() };
  const oauth = oauthTestStore();
  const signingSecret = 'independent-signing-secret';
  const oldEncryptionKey = process.env.API_KEY_SIGNING_ENCRYPTION_KEY;
  const repo: any = {
    create: (value: any) => ({ id: randomUUID(), isActive: true, ...value }),
    save: async (value: any) => { if (!endpoints.includes(value)) endpoints.push(value); return value; },
    findOneBy: async ({ id }: any) => endpoints.find((row) => row.id === id),
    find: async ({ where }: any) => endpoints.filter((row) => Object.entries(where).every(([key, value]) => row[key] === value)),
    remove: async (value: any) => { endpoints.splice(endpoints.indexOf(value), 1); },
  };
  beforeAll(async () => {
    process.env.API_KEY_SIGNING_ENCRYPTION_KEY = 'integration-test-key';
    const secret = encryptSigningSecret(signingSecret);
    const logger = { child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) };
    const module = await Test.createTestingModule({
      controllers: [OAuthController, WebhooksController, HooksController, SigningProbe],
      providers: [WebhooksService, ApiKeyAuthGuard,
        { provide: OAuthService, useValue: oauth.service },
        { provide: HooksService, useValue: new HooksService({ find: async () => [] } as any) },
        { provide: ApiKeysService, useValue: {
          validateKey: async (key: string) => {
            if (!['unsigned-key', 'signed-key'].includes(key)) throw new UnauthorizedException();
            return { id: 'key', userId: merchantId, scopes: ['webhooks:read', 'webhooks:write'],
              requireSignedRequests: key === 'signed-key', signingSecretEncrypted: secret };
          }, recordUsage: jest.fn().mockResolvedValue(undefined),
        } },
        { provide: UsersService, useValue: { assertMerchantActive: jest.fn() } },
        { provide: ConfigService, useValue: { get: (_: string, fallback: any) => fallback } },
        { provide: EmailNotificationService, useValue: {} },
        { provide: AppLogger, useValue: logger },
        { provide: getRepositoryToken(WebhookEndpoint), useValue: repo },
        { provide: getRepositoryToken(WebhookDelivery), useValue: { create: (v: any) => v, save: async (v: any) => ({ id: randomUUID(), ...v }) } },
        { provide: getRepositoryToken(WebhookReplay), useValue: {} },
        { provide: getQueueToken('webhooks'), useValue: queue },
      ],
    }).overrideGuard(JwtAuthGuard).useValue({ canActivate: (context: any) => {
      const req = context.switchToHttp().getRequest();
      if (req.headers.authorization !== 'Bearer merchant-session') throw new UnauthorizedException();
      req.user = { id: merchantId }; return true;
    } }).compile();
    app = module.createNestApplication({ rawBody: true });
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
    if (oldEncryptionKey === undefined) delete process.env.API_KEY_SIGNING_ENCRYPTION_KEY;
    else process.env.API_KEY_SIGNING_ENCRYPTION_KEY = oldEncryptionKey;
  });

  it('registers AWS destinations and uses the same event filters and payload version', async () => {
    queue.add.mockClear();
    const response = await request(app.getHttpServer()).post('/v1/webhooks').set('Authorization', 'Bearer merchant-session').send({
      destinationType: 'sqs', destinationArn: 'arn:aws:sqs:eu-west-1:123456789012:merchant',
      roleArn: 'arn:aws:iam::123456789012:role/facilpay', events: ['payment.completed'], apiVersion: '2026-10-01',
    }).expect(201);
    expect(response.body.destinationType).toBe('sqs');
    const service = app.get(WebhooksService);
    await service.dispatchEventToMerchant(merchantId, 'payment.created', { id: 'payment' });
    expect(queue.add).not.toHaveBeenCalled();
    await service.dispatchEventToMerchant(merchantId, 'payment.completed', { id: 'payment' }, 'event-id');
    expect(queue.add).toHaveBeenCalledWith('deliver', expect.objectContaining({ payload: expect.objectContaining({ version: '2026-10-01', eventId: 'event-id' }) }), expect.objectContaining({ attempts: 6 }));
  });

  it('subscribes, polls samples and unsubscribes with API key authentication', async () => {
    await request(app.getHttpServer()).post('/v1/hooks/subscribe').send({}).expect(401);
    const response = await request(app.getHttpServer()).post('/v1/hooks/subscribe').set('X-API-Key', 'unsigned-key')
      .send({ url: 'https://hooks.example/callback', events: ['customer.created'] }).expect(201);
    expect(response.body.isRestHook).toBe(true);
    await request(app.getHttpServer()).get('/v1/hooks/samples/customer.created').set('X-API-Key', 'unsigned-key').expect(200)
      .expect((result) => expect(result.body[0].id).toBe('sample_customer.created'));
    await request(app.getHttpServer()).delete(`/v1/hooks/${response.body.id}`).set('X-API-Key', 'unsigned-key').expect(204);
    await request(app.getHttpServer()).delete(`/v1/hooks/${response.body.id}`).set('X-API-Key', 'unsigned-key').expect(404);
  });

  it('completes PKCE, uses scoped OAuth access, rotates refresh tokens and revokes the app', async () => {
    const registered = await request(app.getHttpServer()).post('/v1/oauth/apps').set('Authorization', 'Bearer merchant-session')
      .send({ name: 'No-code app', redirectUris: ['https://app.example/callback'], scopes: ['webhooks:read'] }).expect(201);
    const client = registered.body;
    const verifier = 'v'.repeat(43);
    const authorization = { response_type: 'code', client_id: client.client_id, redirect_uri: 'https://app.example/callback', scope: 'webhooks:read',
      code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url'), state: 'state' };
    await request(app.getHttpServer()).get('/v1/oauth/consent').query(authorization).set('Authorization', 'Bearer merchant-session').expect(200);
    const approved = await request(app.getHttpServer()).post('/v1/oauth/authorize').set('Authorization', 'Bearer merchant-session')
      .send({ ...authorization, approved: true }).expect(200);
    const code = new URL(approved.body.redirectUrl).searchParams.get('code');
    const exchanged = await request(app.getHttpServer()).post('/v1/oauth/token').type('form').send({
      grant_type: 'authorization_code', client_id: client.client_id, client_secret: client.client_secret,
      code, code_verifier: verifier, redirect_uri: authorization.redirect_uri,
    }).expect(200);
    expect(exchanged.headers['cache-control']).toBe('no-store');
    const access = exchanged.body.access_token;
    await request(app.getHttpServer()).get('/v1/hooks/samples/customer.created').set('Authorization', `Bearer ${access}`).expect(200);
    await request(app.getHttpServer()).post('/v1/hooks/subscribe').set('Authorization', `Bearer ${access}`)
      .send({ url: 'https://hooks.example/callback', events: ['customer.created'] }).expect(403);
    const rotated = await request(app.getHttpServer()).post('/v1/oauth/token').send({ grant_type: 'refresh_token',
      client_id: client.client_id, client_secret: client.client_secret, refresh_token: exchanged.body.refresh_token }).expect(200);
    const connections = await request(app.getHttpServer()).get('/v1/oauth/connections').set('Authorization', 'Bearer merchant-session').expect(200);
    await request(app.getHttpServer()).delete(`/v1/oauth/connections/${connections.body[0].id}`).set('Authorization', 'Bearer merchant-session').expect(204);
    await request(app.getHttpServer()).get('/v1/hooks/samples/customer.created').set('Authorization', `Bearer ${rotated.body.access_token}`).expect(401);
  });

  it('requires the independent HMAC secret and authenticates the exact request bytes', async () => {
    const body = '{ "message": "signed" }';
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const path = '/v1/signing-probe';
    await request(app.getHttpServer()).post(path).set('X-API-Key', 'signed-key').send({ message: 'signed' }).expect(401);
    const signature = signRequest(signingSecret, 'POST', path, timestamp, Buffer.from(body));
    await request(app.getHttpServer()).post(path).set('X-API-Key', 'signed-key').set('Content-Type', 'application/json')
      .set('X-FacilPay-Timestamp', timestamp).set('X-FacilPay-Signature', signature).send(body).expect(201);
    await request(app.getHttpServer()).post(path).set('X-API-Key', 'signed-key').set('Content-Type', 'application/json')
      .set('X-FacilPay-Timestamp', timestamp).set('X-FacilPay-Signature', signature).send('{"message":"changed"}').expect(401);
    const expired = (Number(timestamp) - 301).toString();
    await request(app.getHttpServer()).post(path).set('X-API-Key', 'signed-key').set('Content-Type', 'application/json')
      .set('X-FacilPay-Timestamp', expired).set('X-FacilPay-Signature', signRequest(signingSecret, 'POST', path, expired, Buffer.from(body))).send(body).expect(401);
  });
});
