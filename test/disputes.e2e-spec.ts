import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { Payment, PaymentStatus } from '../src/modules/payments/payment.entity';
import { Dispute, DisputeStatus, DisputeReason } from '../src/modules/payments/dispute.entity';

describe('DisputesController (e2e)', () => {
  let app: INestApplication;
  let authToken: string;
  let paymentId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: any) => {
          const request = context.switchToHttp().getRequest();
          request.user = { sub: 'test-user-id', email: 'test@example.com', role: 'admin' };
          return true;
        },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    // Create a test payment first
    const paymentResponse = await request(app.getHttpServer())
      .post('/v1/payments')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        amount: 100.00,
        currency: 'USD',
        status: PaymentStatus.COMPLETED,
        description: 'Test payment for dispute',
        merchantEmail: 'merchant@example.com',
        payerEmail: 'payer@example.com',
      });

    paymentId = paymentResponse.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /v1/payments/:id/dispute', () => {
    it('should open a dispute for a completed payment', () => {
      return request(app.getHttpServer())
        .post(`/v1/payments/${paymentId}/dispute`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          reason: DisputeReason.FRAUD,
          description: 'Unauthorized transaction on my card',
          openedBy: 'customer@example.com',
        })
        .expect(201)
        .expect((res) => {
          expect(res.body).toHaveProperty('id');
          expect(res.body.paymentId).toBe(paymentId);
          expect(res.body.status).toBe(DisputeStatus.OPEN);
          expect(res.body.reason).toBe(DisputeReason.FRAUD);
          expect(res.body.description).toBe('Unauthorized transaction on my card');
          expect(res.body.openedBy).toBe('customer@example.com');
        });
    });

    it('should not open a dispute for a pending payment', async () => {
      // Create a pending payment
      const pendingPayment = await request(app.getHttpServer())
        .post('/v1/payments')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          amount: 50.00,
          currency: 'USD',
          description: 'Pending payment',
          merchantEmail: 'merchant@example.com',
          payerEmail: 'payer@example.com',
        });

      return request(app.getHttpServer())
        .post(`/v1/payments/${pendingPayment.body.id}/dispute`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          reason: DisputeReason.FRAUD,
          description: 'This should fail',
        })
        .expect(409);
    });

    it('should not open a duplicate dispute for the same payment', async () => {
      // First dispute
      await request(app.getHttpServer())
        .post(`/v1/payments/${paymentId}/dispute`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          reason: DisputeReason.FRAUD,
          description: 'First dispute',
        });

      // Second dispute should fail
      return request(app.getHttpServer())
        .post(`/v1/payments/${paymentId}/dispute`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          reason: DisputeReason.DUPLICATE,
          description: 'Second dispute attempt',
        })
        .expect(409);
    });

    it('should validate required fields', () => {
      return request(app.getHttpServer())
        .post(`/v1/payments/${paymentId}/dispute`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          description: 'Missing reason',
        })
        .expect(400);
    });
  });

  describe('GET /v1/disputes', () => {
    beforeEach(async () => {
      // Create a payment and dispute for each test
      const payment = await request(app.getHttpServer())
        .post('/v1/payments')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          amount: 200.00,
          currency: 'USD',
          status: PaymentStatus.COMPLETED,
          description: 'Another test payment',
          merchantEmail: 'merchant@example.com',
          payerEmail: 'payer@example.com',
        });

      await request(app.getHttpServer())
        .post(`/v1/payments/${payment.body.id}/dispute`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          reason: DisputeReason.UNAUTHORIZED,
          description: 'Unauthorized charge',
        });
    });

    it('should list all disputes', () => {
      return request(app.getHttpServer())
        .get('/v1/disputes')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body)).toBe(true);
          expect(res.body.length).toBeGreaterThan(0);
        });
    });

    it('should filter disputes by status', () => {
      return request(app.getHttpServer())
        .get('/v1/disputes')
        .query({ status: DisputeStatus.OPEN })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body)).toBe(true);
          res.body.forEach((dispute: Dispute) => {
            expect(dispute.status).toBe(DisputeStatus.OPEN);
          });
        });
    });

    it('should filter disputes by paymentId', () => {
      return request(app.getHttpServer())
        .get('/v1/disputes')
        .query({ paymentId })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body)).toBe(true);
          res.body.forEach((dispute: Dispute) => {
            expect(dispute.paymentId).toBe(paymentId);
          });
        });
    });
  });

  describe('GET /v1/disputes/:id', () => {
    let disputeId: string;

    beforeEach(async () => {
      const response = await request(app.getHttpServer())
        .post(`/v1/payments/${paymentId}/dispute`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          reason: DisputeReason.PRODUCT_NOT_RECEIVED,
          description: 'Product was never delivered',
        });

      disputeId = response.body.id;
    });

    it('should get a dispute by ID', () => {
      return request(app.getHttpServer())
        .get(`/v1/disputes/${disputeId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.id).toBe(disputeId);
          expect(res.body.reason).toBe(DisputeReason.PRODUCT_NOT_RECEIVED);
        });
    });

    it('should return 404 for non-existent dispute', () => {
      return request(app.getHttpServer())
        .get('/v1/disputes/non-existent-id')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });
  });

  describe('PATCH /v1/disputes/:id', () => {
    let disputeId: string;

    beforeEach(async () => {
      const response = await request(app.getHttpServer())
        .post(`/v1/payments/${paymentId}/dispute`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          reason: DisputeReason.PRODUCT_NOT_AS_DESCRIBED,
          description: 'Product does not match description',
        });

      disputeId = response.body.id;
    });

    it('should update dispute status (admin)', () => {
      return request(app.getHttpServer())
        .patch(`/v1/disputes/${disputeId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          status: DisputeStatus.UNDER_REVIEW,
          resolutionNotes: 'Reviewing evidence',
        })
        .expect(200)
        .expect((res) => {
          expect(res.body.status).toBe(DisputeStatus.UNDER_REVIEW);
          expect(res.body.resolutionNotes).toBe('Reviewing evidence');
        });
    });

    it('should validate status transitions', () => {
      return request(app.getHttpServer())
        .patch(`/v1/disputes/${disputeId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          status: DisputeStatus.RESOLVED,
        })
        .expect(409);
    });

    it('should not allow invalid status transitions', () => {
      return request(app.getHttpServer())
        .patch(`/v1/disputes/${disputeId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          status: DisputeStatus.CLOSED,
        })
        .expect(409);
    });
  });
});