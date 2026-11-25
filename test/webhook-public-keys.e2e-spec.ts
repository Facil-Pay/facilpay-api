import { INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { WebhookPublicKeysController } from '../src/modules/webhooks/webhook-public-keys.controller';
import { WebhookSigningKeysService } from '../src/modules/webhooks/webhook-signing-keys.service';
import { WebhookSigningKey } from '../src/modules/webhooks/entities/webhook-signing-key.entity';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { AppLogger } from '../src/modules/logger/logger.service';
import { signBodyEd25519, verifyEd25519Signature } from '../src/modules/webhooks/webhook-signing';

describe('Webhook public keys (e2e)', () => {
  let app: INestApplication;
  const previousKey = process.env.WEBHOOK_SIGNING_KEYS_ENCRYPTION_KEY;
  const rows: any[] = [];
  const repo = {
    create: (value: any) => ({ ...value }),
    save: async (value: any) => {
      if (!value.id) { value.id = randomUUID(); value.createdAt = new Date(Date.now() + rows.length); rows.push(value); }
      return value;
    },
    find: async ({ where, take }: any) => {
      const result = rows
        .filter((row) => row.status === where.status && (!where.expiresAt || (row.expiresAt && row.expiresAt > where.expiresAt.value)))
        .sort((a, b) => b.createdAt - a.createdAt);
      return take ? result.slice(0, take) : result;
    },
  };

  beforeAll(async () => {
    process.env.WEBHOOK_SIGNING_KEYS_ENCRYPTION_KEY = 'e2e-signing-key';
    const logger = { child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) };
    const module = await Test.createTestingModule({
      controllers: [WebhookPublicKeysController],
      providers: [
        WebhookSigningKeysService,
        { provide: getRepositoryToken(WebhookSigningKey), useValue: repo },
        { provide: ConfigService, useValue: { get: (_: string, fallback: any) => fallback } },
        { provide: AppLogger, useValue: logger },
      ],
    }).overrideGuard(JwtAuthGuard).useValue({ canActivate: (context: any) => {
      const req = context.switchToHttp().getRequest();
      if (req.headers.authorization === 'Bearer admin') req.user = { id: 'admin', roles: ['ADMIN'] };
      else if (req.headers.authorization === 'Bearer merchant') req.user = { id: 'merchant', roles: ['USER'] };
      else throw new UnauthorizedException();
      return true;
    } }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    if (previousKey === undefined) delete process.env.WEBHOOK_SIGNING_KEYS_ENCRYPTION_KEY;
    else process.env.WEBHOOK_SIGNING_KEYS_ENCRYPTION_KEY = previousKey;
  });

  it('publishes keys without authentication and never exposes private material', async () => {
    const service = app.get(WebhookSigningKeysService);
    const signingKey = await service.getSigningKey();
    const response = await request(app.getHttpServer()).get('/v1/webhooks/public-keys').expect(200);
    expect(response.body.keys).toHaveLength(1);
    expect(response.body.keys[0]).toMatchObject({ kid: signingKey.kid, algorithm: 'ed25519', status: 'active' });
    expect(JSON.stringify(response.body)).not.toContain('PRIVATE');

    const header = signBodyEd25519('{"event":"test"}', signingKey);
    const published = Object.fromEntries(response.body.keys.map((k: any) => [k.kid, k.publicKeyPem]));
    expect(verifyEd25519Signature(header, '{"event":"test"}', published)).toBe(true);
  });

  it('only lets platform admins rotate, and keeps the old key during the grace period', async () => {
    await request(app.getHttpServer()).post('/v1/webhooks/public-keys/rotate').send({}).expect(401);
    await request(app.getHttpServer()).post('/v1/webhooks/public-keys/rotate').set('Authorization', 'Bearer merchant').send({}).expect(403);
    const before = await request(app.getHttpServer()).get('/v1/webhooks/public-keys').expect(200);
    const oldKid = before.body.keys[0].kid;

    const rotated = await request(app.getHttpServer()).post('/v1/webhooks/public-keys/rotate')
      .set('Authorization', 'Bearer admin').send({ gracePeriodHours: 48 }).expect(200);
    expect(rotated.body.keys.map((k: any) => k.status)).toEqual(['active', 'retiring']);
    expect(rotated.body.keys[1].kid).toBe(oldKid);
    expect(rotated.body.keys[0].kid).not.toBe(oldKid);

    await request(app.getHttpServer()).post('/v1/webhooks/public-keys/rotate')
      .set('Authorization', 'Bearer admin').send({ gracePeriodHours: -1 }).expect(400);
  });
});
