import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
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
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  // ── POST /payments ──────────────────────────────────────────────────────────

  describe('POST /payments', () => {
    it('creates a payment and returns 201 with PENDING status', async () => {
      const response = await request(app.getHttpServer())
        .post('/payments')
        .send({ amount: 50.0, currency: 'EUR', description: 'E2E Test payment' })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.status).toBe('PENDING');
      expect(response.body.currency).toBe('EUR');
      paymentId = response.body.id;
    });

    it('returns 400 when amount is missing', async () => {
      const response = await request(app.getHttpServer())
        .post('/payments')
        .send({ currency: 'USD' })
        .expect(400);

      expect(response.body.statusCode).toBe(400);
    });

    it('returns 400 when amount is zero', async () => {
      await request(app.getHttpServer())
        .post('/payments')
        .send({ amount: 0, currency: 'USD' })
        .expect(400);
    });

    it('returns 400 when currency is missing', async () => {
      await request(app.getHttpServer())
        .post('/payments')
        .send({ amount: 10 })
        .expect(400);
    });

    it('returns 400 when currency exceeds 3 characters', async () => {
      await request(app.getHttpServer())
        .post('/payments')
        .send({ amount: 10, currency: 'USDD' })
        .expect(400);
    });
  });

  // ── GET /payments ───────────────────────────────────────────────────────────

  describe('GET /payments', () => {
    it('returns 200 with an array of payments', async () => {
      const response = await request(app.getHttpServer())
        .get('/payments')
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
    });
  });

  // ── GET /payments/:id ───────────────────────────────────────────────────────

  describe('GET /payments/:id', () => {
    it('returns 200 with payment details for a valid ID', async () => {
      const response = await request(app.getHttpServer())
        .get(`/payments/${paymentId}`)
        .expect(200);

      expect(response.body.id).toBe(paymentId);
      expect(response.body).toHaveProperty('amount');
      expect(response.body).toHaveProperty('currency');
      expect(response.body).toHaveProperty('status');
    });

    it('returns 404 for a non-existent payment ID', async () => {
      const nonExistentId = '00000000-0000-4000-a000-000000000000';
      const response = await request(app.getHttpServer())
        .get(`/payments/${nonExistentId}`)
        .expect(404);

      expect(response.body.statusCode).toBe(404);
    });
  });

  // ── POST /payments/webhook ──────────────────────────────────────────────────

  describe('POST /payments/webhook', () => {
    it('returns 400 when X-Signature header is missing', async () => {
      await request(app.getHttpServer())
        .post('/payments/webhook')
        .send({ paymentId, status: 'COMPLETED' })
        .expect(400);
    });

    it('returns 400 when X-Signature is invalid', async () => {
      await request(app.getHttpServer())
        .post('/payments/webhook')
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
        .post('/payments/webhook')
        .set('X-Signature', signature)
        .send(body)
        .expect(200);

      expect(response.body.status).toBe('COMPLETED');
      expect(response.body.externalReference).toBe('EXT-E2E-123');
    });

    it('updates payment status to FAILED with valid signature', async () => {
      const newPayment = await request(app.getHttpServer())
        .post('/payments')
        .send({ amount: 25.0, currency: 'GBP' })
        .expect(201);

      const body = { paymentId: newPayment.body.id, status: 'FAILED' };
      const signature = generateSignature(body);

      const response = await request(app.getHttpServer())
        .post('/payments/webhook')
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
        .post('/payments/webhook')
        .set('X-Signature', signature)
        .send(body)
        .expect(404);
    });
  });
});
