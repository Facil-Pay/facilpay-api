import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { DataSource } from 'typeorm';

describe('Idempotency (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    dataSource = moduleFixture.get<DataSource>(DataSource);
  });

  afterAll(async () => {
    await dataSource.destroy();
    await app.close();
  });

  afterEach(async () => {
    await dataSource.query('DELETE FROM idempotency_keys');
    await dataSource.query('DELETE FROM payments');
  });

  it('should create payment without idempotency key', () => {
    return request(app.getHttpServer())
      .post('/payments')
      .send({ amount: 100, currency: 'USD' })
      .expect(201)
      .expect((res) => {
        expect(res.body).toHaveProperty('id');
        expect(res.body.amount).toBe('100.00');
      });
  });

  it('should return same response for duplicate idempotency key', async () => {
    const idempotencyKey = 'test-key-123';
    const payload = { amount: 100, currency: 'USD' };

    const firstResponse = await request(app.getHttpServer())
      .post('/payments')
      .set('Idempotency-Key', idempotencyKey)
      .send(payload)
      .expect(201);

    const secondResponse = await request(app.getHttpServer())
      .post('/payments')
      .set('Idempotency-Key', idempotencyKey)
      .send(payload)
      .expect(201);

    expect(firstResponse.body.id).toBe(secondResponse.body.id);
    expect(firstResponse.body.createdAt).toBe(secondResponse.body.createdAt);

    const payments = await dataSource.query('SELECT * FROM payments');
    expect(payments).toHaveLength(1);
  });

  it('should return 422 for same key with different body', async () => {
    const idempotencyKey = 'test-key-456';

    await request(app.getHttpServer())
      .post('/payments')
      .set('Idempotency-Key', idempotencyKey)
      .send({ amount: 100, currency: 'USD' })
      .expect(201);

    return request(app.getHttpServer())
      .post('/payments')
      .set('Idempotency-Key', idempotencyKey)
      .send({ amount: 200, currency: 'EUR' })
      .expect(422)
      .expect((res) => {
        expect(res.body.message).toContain('different request body');
      });
  });

  it('should allow different keys for same body', async () => {
    const payload = { amount: 100, currency: 'USD' };

    const firstResponse = await request(app.getHttpServer())
      .post('/payments')
      .set('Idempotency-Key', 'key-1')
      .send(payload)
      .expect(201);

    const secondResponse = await request(app.getHttpServer())
      .post('/payments')
      .set('Idempotency-Key', 'key-2')
      .send(payload)
      .expect(201);

    expect(firstResponse.body.id).not.toBe(secondResponse.body.id);

    const payments = await dataSource.query('SELECT * FROM payments');
    expect(payments).toHaveLength(2);
  });

  it('should handle concurrent requests atomically', async () => {
    const idempotencyKey = 'concurrent-key-789';
    const payload = { amount: 150, currency: 'USD' };

    // Send two requests in parallel
    const [res1, res2] = await Promise.all([
      request(app.getHttpServer())
        .post('/payments')
        .set('Idempotency-Key', idempotencyKey)
        .send(payload),
      request(app.getHttpServer())
        .post('/payments')
        .set('Idempotency-Key', idempotencyKey)
        .send(payload),
    ]);

    // One of them should succeed with 201, the other should return 409
    const statuses = [res1.status, res2.status];
    expect(statuses).toContain(201);
    expect(statuses).toContain(409);

    // Verify only one payment was created in DB
    const payments = await dataSource.query('SELECT * FROM payments');
    expect(payments).toHaveLength(1);
  });
});
