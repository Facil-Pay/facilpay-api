import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, UnprocessableEntityException } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import * as crypto from 'crypto';
import { AppModule } from './../src/app.module';

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';

function generateSignature(body: object): string {
  return crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(JSON.stringify(body))
    .digest('hex');
}

describe('PaymentsModule (e2e)', () => {
  let app: INestApplication<App>;
  let paymentId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
        transformOptions: { enableImplicitConversion: true },
        exceptionFactory: (errors) => {
          const messages = errors.flatMap((e) =>
            e.constraints ? Object.values(e.constraints) : [],
          );
          return new UnprocessableEntityException(
            messages.length ? messages : 'Validation failed',
          );
        },
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  // ── POST /v1/payments ──────────────────────────────────────────────────────────

  describe('POST /v1/payments', () => {
    it('creates a payment and returns 201 with PENDING status', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/payments')
        .send({ amount: 50.0, currency: 'EUR', description: 'E2E Test payment' })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.status).toBe('PENDING');
      expect(response.body.currency).toBe('EUR');
      paymentId = response.body.id;
    });

    it('returns 422 when amount is missing', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/payments')
        .send({ currency: 'USD' })
        .expect(422);

      expect(response.body.statusCode).toBe(422);
    });

    it('returns 422 when amount is zero', async () => {
      await request(app.getHttpServer())
        .post('/v1/payments')
        .send({ amount: 0, currency: 'USD' })
        .expect(422);
    });

    it('returns 422 when currency is missing', async () => {
      await request(app.getHttpServer())
        .post('/v1/payments')
        .send({ amount: 10 })
        .expect(422);
    });

    it('returns 422 when currency exceeds 3 characters', async () => {
      await request(app.getHttpServer())
        .post('/v1/payments')
        .send({ amount: 10, currency: 'USDD' })
        .expect(422);
    });

    it('returns 422 when currency is not a valid ISO 4217 code', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/payments')
        .send({ amount: 10, currency: 'XYZ' })
        .expect(422);

      expect(response.body.statusCode).toBe(422);
      expect(response.body.message).toEqual(
        expect.arrayContaining([
          expect.stringContaining('not a valid ISO 4217'),
        ]),
      );
    });

    it('returns 422 when currency is valid ISO 4217 but not supported', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/payments')
        .send({ amount: 10, currency: 'JPY' })
        .expect(422);

      expect(response.body.statusCode).toBe(422);
      expect(response.body.message).toEqual(
        expect.arrayContaining([
          expect.stringContaining('is not supported'),
        ]),
      );
    });
  });

  // ── GET /v1/payments ───────────────────────────────────────────────────────────

  describe('GET /v1/payments', () => {
    it('returns 200 with an array of payments', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/payments')
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
    });
  });

  // ── GET /v1/payments/:id ───────────────────────────────────────────────────

  describe('GET /v1/payments/:id', () => {
    it('returns 200 with payment details for a valid ID', async () => {
      const response = await request(app.getHttpServer())
        .get(`/v1/payments/${paymentId}`)
        .expect(200);

      expect(response.body.id).toBe(paymentId);
      expect(response.body).toHaveProperty('amount');
      expect(response.body).toHaveProperty('currency');
      expect(response.body).toHaveProperty('status');
    });

    it('returns 404 for a non-existent payment ID', async () => {
      const nonExistentId = '00000000-0000-4000-a000-000000000000';
      const response = await request(app.getHttpServer())
        .get(`/v1/payments/${nonExistentId}`)
        .expect(404);

      expect(response.body.statusCode).toBe(404);
    });
  });

  // ── POST /v1/payments/webhook ──────────────────────────────────────────────────

  describe('POST /v1/payments/webhook', () => {
    it('returns 400 when X-Signature header is missing', async () => {
      await request(app.getHttpServer())
        .post('/v1/payments/webhook')
        .send({ paymentId, status: 'COMPLETED' })
        .expect(400);
    });

    it('returns 400 when X-Signature is invalid', async () => {
      await request(app.getHttpServer())
        .post('/v1/payments/webhook')
        .set('X-Signature', 'invalid-signature')
        .send({ paymentId, status: 'COMPLETED' })
        .expect(400);
    });

    it('updates payment status to COMPLETED with valid signature', async () => {
      const body = {
        paymentId,
        status: 'COMPLETED',
        externalReference: 'EXT-E2E-123',
      };
      const signature = generateSignature(body);

      const response = await request(app.getHttpServer())
        .post('/v1/payments/webhook')
        .set('X-Signature', signature)
        .send(body)
        .expect(200);

      expect(response.body.status).toBe('COMPLETED');
      expect(response.body.externalReference).toBe('EXT-E2E-123');
    });

    it('updates payment status to FAILED with valid signature', async () => {
      const newPayment = await request(app.getHttpServer())
        .post('/v1/payments')
        .send({ amount: 25.0, currency: 'GBP' })
        .expect(201);

      const body = { paymentId: newPayment.body.id, status: 'FAILED' };
      const signature = generateSignature(body);

      const response = await request(app.getHttpServer())
        .post('/v1/payments/webhook')
        .set('X-Signature', signature)
        .send(body)
        .expect(200);

      expect(response.body.status).toBe('FAILED');
    });

    it('returns 404 via webhook for a non-existent payment ID', async () => {
      const nonExistentId = '00000000-0000-4000-a000-000000000000';
      const body = { paymentId: nonExistentId, status: 'COMPLETED' };
      const signature = generateSignature(body);

      await request(app.getHttpServer())
        .post('/v1/payments/webhook')
        .set('X-Signature', signature)
        .send(body)
        .expect(404);
    });
  });

  // ── GET /v1/currencies ────────────────────────────────────────────────────────

  describe('GET /v1/currencies', () => {
    it('returns 200 with the supported currency list from env', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/currencies')
        .expect(200);

      expect(response.body).toHaveProperty('currencies');
      expect(Array.isArray(response.body.currencies)).toBe(true);

      const codes = response.body.currencies.map((c: { code: string }) => c.code);
      expect(codes).toContain('USD');
      expect(codes).toContain('EUR');
      expect(codes).toContain('GBP');

      for (const currency of response.body.currencies) {
        expect(currency).toHaveProperty('code');
        expect(currency).toHaveProperty('name');
        expect(currency).toHaveProperty('symbol');
      }
    });
  });
});
