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
});
