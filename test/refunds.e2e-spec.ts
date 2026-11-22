import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { DataSource } from 'typeorm';

describe('Refunds (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const authToken = 'test-token';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: any) => {
          const request = context.switchToHttp().getRequest();
          request.user = { id: 'test-admin-id', email: 'admin@example.com' };
          return true;
        },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    dataSource = moduleFixture.get<DataSource>(DataSource);
  });

  afterAll(async () => {
    await dataSource.destroy();
    await app.close();
  });

  afterEach(async () => {
    await dataSource.query('DELETE FROM refunds');
    await dataSource.query('DELETE FROM payments');
  });

  it('should process full refund', async () => {
    const payment = await request(app.getHttpServer())
      .post('/payments')
      .send({ amount: 100, currency: 'USD' })
      .expect(201);

    await dataSource.query(
      `UPDATE payments SET status = 'COMPLETED' WHERE id = $1`,
      [payment.body.id],
    );

    const refundResponse = await request(app.getHttpServer())
      .post(`/payments/${payment.body.id}/refund`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({})
      .expect(201);

    expect(refundResponse.body.payment.status).toBe('REFUNDED');
    expect(refundResponse.body.payment.refundedAmount).toBe('100.00');
    expect(refundResponse.body.refund.amount).toBe('100.00');
    expect(refundResponse.body.refund.initiatedBy).toBe('test-admin-id');
  });

  it('should process partial refund', async () => {
    const payment = await request(app.getHttpServer())
      .post('/payments')
      .send({ amount: 100, currency: 'USD' })
      .expect(201);

    await dataSource.query(
      `UPDATE payments SET status = 'COMPLETED' WHERE id = $1`,
      [payment.body.id],
    );

    const refundResponse = await request(app.getHttpServer())
      .post(`/payments/${payment.body.id}/refund`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ amount: 50, reason: 'Partial refund requested' })
      .expect(201);

    expect(refundResponse.body.payment.status).toBe('PARTIALLY_REFUNDED');
    expect(refundResponse.body.payment.refundedAmount).toBe('50.00');
    expect(refundResponse.body.refund.amount).toBe('50.00');
  });

  it('should return 409 for PENDING payment', async () => {
    const payment = await request(app.getHttpServer())
      .post('/payments')
      .send({ amount: 100, currency: 'USD' })
      .expect(201);

    return request(app.getHttpServer())
      .post(`/payments/${payment.body.id}/refund`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({})
      .expect(409)
      .expect((res) => {
        expect(res.body.message).toContain('pending');
      });
  });

  it('should return 409 for already REFUNDED payment', async () => {
    const payment = await request(app.getHttpServer())
      .post('/payments')
      .send({ amount: 100, currency: 'USD' })
      .expect(201);

    await dataSource.query(
      `UPDATE payments SET status = 'COMPLETED' WHERE id = $1`,
      [payment.body.id],
    );

    await request(app.getHttpServer())
      .post(`/payments/${payment.body.id}/refund`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({})
      .expect(201);

    return request(app.getHttpServer())
      .post(`/payments/${payment.body.id}/refund`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({})
      .expect(409)
      .expect((res) => {
        expect(res.body.message).toContain('already fully refunded');
      });
  });

  it('should return 409 when refund exceeds remaining amount', async () => {
    const payment = await request(app.getHttpServer())
      .post('/payments')
      .send({ amount: 100, currency: 'USD' })
      .expect(201);

    await dataSource.query(
      `UPDATE payments SET status = 'COMPLETED' WHERE id = $1`,
      [payment.body.id],
    );

    await request(app.getHttpServer())
      .post(`/payments/${payment.body.id}/refund`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ amount: 60 })
      .expect(201);

    return request(app.getHttpServer())
      .post(`/payments/${payment.body.id}/refund`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ amount: 50 })
      .expect(409)
      .expect((res) => {
        expect(res.body.message).toContain('exceeds remaining');
      });
  });

  it('should retrieve refunds via GET /payments/:id', async () => {
    const payment = await request(app.getHttpServer())
      .post('/payments')
      .send({ amount: 100, currency: 'USD' })
      .expect(201);

    await dataSource.query(
      `UPDATE payments SET status = 'COMPLETED' WHERE id = $1`,
      [payment.body.id],
    );

    await request(app.getHttpServer())
      .post(`/payments/${payment.body.id}/refund`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ amount: 30 })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/payments/${payment.body.id}/refund`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ amount: 20 })
      .expect(201);

    const getResponse = await request(app.getHttpServer())
      .get(`/payments/${payment.body.id}`)
      .expect(200);

    expect(getResponse.body.refunds).toHaveLength(2);
    expect(getResponse.body.refunds[0].amount).toBe('20.00');
    expect(getResponse.body.refunds[1].amount).toBe('30.00');
    expect(getResponse.body.refunds[0].initiatedBy).toBe('test-admin-id');
  });

  it('lists merchant refunds with combined filters and pagination', async () => {
    const payments = await Promise.all(
      [
        { reasonCode: 'OTHER', merchantId: 'test-admin-id' },
        { reasonCode: 'FRAUDULENT', merchantId: 'test-admin-id' },
        { reasonCode: 'OTHER', merchantId: 'another-merchant-id' },
      ].map(async ({ reasonCode, merchantId }) => {
        const payment = await request(app.getHttpServer())
          .post('/payments')
          .send({ amount: 100, currency: 'USD' })
          .expect(201);

        await dataSource.query(
          `UPDATE payments SET status = 'COMPLETED', "merchantId" = $2 WHERE id = $1`,
          [payment.body.id, merchantId],
        );

        await request(app.getHttpServer())
          .post(`/payments/${payment.body.id}/refund`)
          .set('Authorization', `Bearer ${authToken}`)
          .send({ reasonCode })
          .expect(201);

        return payment.body.id;
      }),
    );
    const from = new Date(Date.now() - 60_000).toISOString();
    const to = new Date(Date.now() + 60_000).toISOString();

    const filtered = await request(app.getHttpServer())
      .get('/refunds')
      .set('Authorization', `Bearer ${authToken}`)
      .query({
        status: 'EXECUTED',
        from,
        to,
        paymentId: payments[0],
        reasonCode: 'OTHER',
        page: 1,
        limit: 1,
      })
      .expect(200);

    expect(filtered.body.total).toBe(1);
    expect(filtered.body.data).toHaveLength(1);
    expect(filtered.body.data[0].paymentId).toBe(payments[0]);

    const merchantRefunds = await request(app.getHttpServer())
      .get('/refunds')
      .set('Authorization', `Bearer ${authToken}`)
      .query({ page: 1, limit: 1 })
      .expect(200);

    expect(merchantRefunds.body.total).toBe(2);
    expect(merchantRefunds.body.data).toHaveLength(1);
    expect(merchantRefunds.body.data[0].paymentId).not.toBe(payments[2]);
  });

  it('keeps internal payment notes merchant-scoped and out of payment detail', async () => {
    const payment = await request(app.getHttpServer())
      .post('/payments')
      .send({ amount: 100, currency: 'USD' })
      .expect(201);
    await dataSource.query(
      `UPDATE payments SET "merchantId" = $2 WHERE id = $1`,
      [payment.body.id, 'test-admin-id'],
    );

    const created = await request(app.getHttpServer())
      .post(`/payments/${payment.body.id}/notes`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ body: '  Customer called about a delayed transfer.  ' })
      .expect(201);

    expect(created.body.body).toBe('Customer called about a delayed transfer.');
    expect(created.body.authorId).toBe('test-admin-id');

    const notes = await request(app.getHttpServer())
      .get(`/payments/${payment.body.id}/notes`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    expect(notes.body).toHaveLength(1);
    expect(notes.body[0].id).toBe(created.body.id);

    const timeline = await request(app.getHttpServer())
      .get(`/payments/${payment.body.id}/timeline`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    expect(timeline.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'payment.note_added',
          data: expect.objectContaining({ body: created.body.body }),
        }),
      ]),
    );

    const paymentDetail = await request(app.getHttpServer())
      .get(`/payments/${payment.body.id}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    expect(paymentDetail.body).not.toHaveProperty('notes');

    await dataSource.query(
      `UPDATE payments SET "merchantId" = $2 WHERE id = $1`,
      [payment.body.id, 'another-merchant-id'],
    );
    await request(app.getHttpServer())
      .get(`/payments/${payment.body.id}/notes`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .post(`/payments/${payment.body.id}/notes`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ body: 'Should not be allowed' })
      .expect(404);
  });
});
