import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('PaymentsModule (e2e)', () => {
  let app: INestApplication<App>;
  let paymentId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/payments (POST) - Initiate payment', async () => {
    const response = await request(app.getHttpServer())
      .post('/payments')
      .send({
        amount: 50.0,
        currency: 'EUR',
        description: 'E2E Test payment',
      })
      .expect(201);

    expect(response.body).toHaveProperty('id');
    expect(response.body.amount).toBe(50.0);
    expect(response.body.status).toBe('PENDING');
    paymentId = response.body.id;
  });

  it('/payments (GET) - Get all payments', async () => {
    const response = await request(app.getHttpServer())
      .get('/payments')
      .expect(200);

    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBeGreaterThan(0);
  });

  it('/payments/:id (GET) - Get payment details', async () => {
    const response = await request(app.getHttpServer())
      .get(`/payments/${paymentId}`)
      .expect(200);

    expect(response.body.id).toBe(paymentId);
  });

  it('/payments/webhook (POST) - Update payment status', async () => {
    const webhookData = {
      paymentId: paymentId,
      status: 'COMPLETED',
      externalReference: 'EXT-E2E-123',
    };

    const response = await request(app.getHttpServer())
      .post('/payments/webhook')
      .send(webhookData)
      .expect(200);

    expect(response.body.status).toBe('COMPLETED');
    expect(response.body.externalReference).toBe('EXT-E2E-123');
  });
});
