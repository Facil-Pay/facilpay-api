import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  ValidationPipe,
  UnprocessableEntityException,
} from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { DataSource } from 'typeorm';
import {
  UnmatchedTransaction,
  UnmatchedTransactionStatus,
} from '../src/modules/unmatched-transactions/entities/unmatched-transaction.entity';
import { Payment, PaymentStatus } from '../src/modules/payments/payment.entity';

describe('UnmatchedTransactions (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication({ rawBody: true });
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
    ds = moduleFixture.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    // Clean up test rows between cases
    await ds.getRepository(UnmatchedTransaction).delete({});
    await ds.query(`DELETE FROM payments WHERE description LIKE 'e2e-unmatched%'`);
  });

  // ── GET /v1/unmatched-transactions ─────────────────────────────────────────

  describe('GET /v1/unmatched-transactions', () => {
    it('returns 401 without a JWT', async () => {
      await request(app.getHttpServer())
        .get('/v1/unmatched-transactions')
        .expect(401);
    });

    it('returns an empty list when no records exist', async () => {
      const { body } = await request(app.getHttpServer())
        .get('/v1/unmatched-transactions')
        .expect(200);

      expect(body).toMatchObject({ data: [], total: 0 });
    });
  });

  // ── POST /v1/unmatched-transactions/:id/match ─────────────────────────────

  describe('POST /v1/unmatched-transactions/:id/match', () => {
    it('completes the payment and marks the transaction as MATCHED', async () => {
      // Seed an unmatched transaction
      const repo = ds.getRepository(UnmatchedTransaction);
      const tx = await repo.save(
        repo.create({
          transactionHash: 'e2e-hash-match-01',
          fromAddress: 'GABC',
          amount: '50.0000000',
          assetCode: 'XLM',
          memo: null,
          status: UnmatchedTransactionStatus.PENDING,
          matchedPaymentId: null,
          resolvedBy: null,
          resolvedAt: null,
        }),
      );

      // Seed a pending payment
      const payRepo = ds.getRepository(Payment);
      const payment = await payRepo.save(
        payRepo.create({
          amount: 50,
          currency: 'XLM',
          status: PaymentStatus.PENDING,
          description: 'e2e-unmatched-match-test',
        }),
      );

      const { body } = await request(app.getHttpServer())
        .post(`/v1/unmatched-transactions/${tx.id}/match`)
        .send({ paymentId: payment.id })
        .expect(200);

      expect(body.status).toBe(UnmatchedTransactionStatus.MATCHED);
      expect(body.matchedPaymentId).toBe(payment.id);

      const updatedPayment = await payRepo.findOneBy({ id: payment.id });
      expect(updatedPayment?.status).toBe(PaymentStatus.COMPLETED);
    });

    it('returns 409 when the transaction is already matched', async () => {
      const repo = ds.getRepository(UnmatchedTransaction);
      const tx = await repo.save(
        repo.create({
          transactionHash: 'e2e-hash-match-02',
          fromAddress: 'GABC',
          amount: '50.0000000',
          assetCode: 'XLM',
          memo: null,
          status: UnmatchedTransactionStatus.MATCHED,
          matchedPaymentId: 'some-payment-id',
          resolvedBy: 'user-1',
          resolvedAt: new Date(),
        }),
      );

      await request(app.getHttpServer())
        .post(`/v1/unmatched-transactions/${tx.id}/match`)
        .send({ paymentId: '00000000-0000-0000-0000-000000000001' })
        .expect(409);
    });

    it('returns 400 when paymentId is not a UUID', async () => {
      const repo = ds.getRepository(UnmatchedTransaction);
      const tx = await repo.save(
        repo.create({
          transactionHash: 'e2e-hash-match-03',
          fromAddress: 'GABC',
          amount: '50.0000000',
          assetCode: 'XLM',
          memo: null,
          status: UnmatchedTransactionStatus.PENDING,
          matchedPaymentId: null,
          resolvedBy: null,
          resolvedAt: null,
        }),
      );

      await request(app.getHttpServer())
        .post(`/v1/unmatched-transactions/${tx.id}/match`)
        .send({ paymentId: 'not-a-uuid' })
        .expect(422);
    });
  });

  // ── POST /v1/unmatched-transactions/:id/refund ────────────────────────────

  describe('POST /v1/unmatched-transactions/:id/refund', () => {
    it('marks the transaction as REFUNDED', async () => {
      const repo = ds.getRepository(UnmatchedTransaction);
      const tx = await repo.save(
        repo.create({
          transactionHash: 'e2e-hash-refund-01',
          fromAddress: 'GABC',
          amount: '25.0000000',
          assetCode: 'XLM',
          memo: null,
          status: UnmatchedTransactionStatus.PENDING,
          matchedPaymentId: null,
          resolvedBy: null,
          resolvedAt: null,
        }),
      );

      const { body } = await request(app.getHttpServer())
        .post(`/v1/unmatched-transactions/${tx.id}/refund`)
        .expect(200);

      expect(body.status).toBe(UnmatchedTransactionStatus.REFUNDED);
    });

    it('returns 409 when the transaction is already resolved', async () => {
      const repo = ds.getRepository(UnmatchedTransaction);
      const tx = await repo.save(
        repo.create({
          transactionHash: 'e2e-hash-refund-02',
          fromAddress: 'GABC',
          amount: '25.0000000',
          assetCode: 'XLM',
          memo: null,
          status: UnmatchedTransactionStatus.REFUNDED,
          matchedPaymentId: null,
          resolvedBy: 'user-1',
          resolvedAt: new Date(),
        }),
      );

      await request(app.getHttpServer())
        .post(`/v1/unmatched-transactions/${tx.id}/refund`)
        .expect(409);
    });
  });
});
