jest.mock('../../tracing', () => ({
  initializeTracing: jest.fn(),
  getTraceId: jest.fn(),
  runWithTrace: (_name: string, fn: () => unknown) => fn(),
}));
jest.mock('../invoices/invoice.entity', () => ({
  Invoice: class {},
  InvoiceStatus: {
    DRAFT: 'draft',
    OPEN: 'open',
    PAID: 'paid',
    VOID: 'void',
    UNCOLLECTIBLE: 'uncollectible',
  },
}));

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { PaymentsService } from './payments.service';
import { Refund, RefundStatus, RefundReasonCode } from './refund.entity';
import { Payment, PaymentStatus } from './payment.entity';
import { MerchantFeeConfig } from './merchant-fee-config.entity';
import { PaymentSplit } from './payment-split.entity';
import { Dispute } from './dispute.entity';
import { SettlementAdjustment } from '../settlements/entities/settlement-adjustment.entity';
import { MerchantSettings } from '../merchants/entities/merchant-settings.entity';
import { AppLogger } from '../logger/logger.service';
import { PaymentSseService } from './payment-sse.service';
import { EmailNotificationService } from '../notifications/email-notification.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { StellarService } from '../stellar/stellar.service';
import { UsersService } from '../users/users.service';
import { PaymentLinksService } from '../payment-links/payment-links.service';
import { EventsService } from '../events/events.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { RejectRefundDto } from './dto/reject-refund.dto';

const makeMockRefund = (overrides: Partial<Refund> = {}): Refund =>
  ({
    id: 'refund-uuid',
    paymentId: 'payment-uuid',
    amount: 150,
    reasonCode: RefundReasonCode.OTHER,
    reason: null,
    initiatedBy: 'initiator-user',
    status: RefundStatus.PENDING_APPROVAL,
    stellarTransactionHash: null,
    claimableBalanceId: null,
    approvedBy: null,
    approvedAt: null,
    rejectedBy: null,
    rejectedAt: null,
    rejectionReason: null,
    cancelledBy: null,
    cancelledAt: null,
    expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
    createdAt: new Date(),
    ...overrides,
  } as Refund);

const makeMockPayment = (overrides: Partial<Payment> = {}): Payment =>
  ({
    id: 'payment-uuid',
    merchantId: 'merchant-uuid',
    merchantEmail: 'merchant@example.com',
    amount: 200,
    refundedAmount: 0,
    status: PaymentStatus.COMPLETED,
    currency: 'USD',
    settlementId: null,
    ...overrides,
  } as Payment);

const makeQueryRunner = (refund: Refund | null, payment: Payment | null) => ({
  connect: jest.fn(),
  startTransaction: jest.fn(),
  commitTransaction: jest.fn(),
  rollbackTransaction: jest.fn(),
  release: jest.fn(),
  manager: {
    findOneBy: jest.fn().mockImplementation((entity) => {
      if (entity === Refund) return Promise.resolve(refund);
      if (entity === Payment) return Promise.resolve(payment);
      return Promise.resolve(null);
    }),
    save: jest.fn().mockImplementation((v) => Promise.resolve(v)),
    create: jest.fn().mockImplementation((_, v) => v),
    query: jest.fn().mockResolvedValue([]),
  },
});

describe('PaymentsService — maker-checker refund approval & cancellation', () => {
  let service: PaymentsService;
  let refundRepo: { findOneBy: jest.Mock; save: jest.Mock; createQueryBuilder: jest.Mock };
  let paymentRepo: { findOneBy: jest.Mock };
  let dataSource: { createQueryRunner: jest.Mock };
  let auditLogsService: { record: jest.Mock };

  const buildModule = async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: getRepositoryToken(Refund), useValue: refundRepo },
        { provide: getRepositoryToken(Payment), useValue: paymentRepo },
        { provide: getRepositoryToken(MerchantFeeConfig), useValue: { findOneBy: jest.fn() } },
        { provide: getRepositoryToken(PaymentSplit), useValue: {} },
        { provide: getRepositoryToken(Dispute), useValue: {} },
        { provide: getRepositoryToken(SettlementAdjustment), useValue: {} },
        { provide: getRepositoryToken(MerchantSettings), useValue: { findOneBy: jest.fn() } },
        { provide: DataSource, useValue: dataSource },
        {
          provide: AppLogger,
          useValue: {
            child: () => ({
              info: jest.fn(),
              error: jest.fn(),
              warn: jest.fn(),
              debug: jest.fn(),
            }),
          },
        },
        { provide: PaymentSseService, useValue: { emit: jest.fn() } },
        {
          provide: EmailNotificationService,
          useValue: {
            sendRefundApprovalOutcome: jest.fn().mockResolvedValue(undefined),
            sendRefundNotifications: jest.fn().mockResolvedValue(undefined),
            sendMerchantRefundIssued: jest.fn().mockResolvedValue(undefined),
            sendPayerRefundProcessed: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: WebhooksService, useValue: { dispatchEventToMerchant: jest.fn().mockResolvedValue(undefined) } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: StellarService, useValue: {} },
        { provide: UsersService, useValue: {} },
        { provide: PaymentLinksService, useValue: {} },
        { provide: EventsService, useValue: { emit: jest.fn() } },
        { provide: AuditLogsService, useValue: auditLogsService },
      ],
    }).compile();
    service = module.get<PaymentsService>(PaymentsService);
  };

  beforeEach(async () => {
    refundRepo = {
      findOneBy: jest.fn(),
      save: jest.fn().mockImplementation((v) => Promise.resolve(v)),
      createQueryBuilder: jest.fn(),
    };
    paymentRepo = { findOneBy: jest.fn() };
    dataSource = { createQueryRunner: jest.fn() };
    auditLogsService = { record: jest.fn().mockResolvedValue({}) };
    await buildModule();
  });

  describe('approveRefund', () => {
    it('throws NotFoundException when refund does not exist', async () => {
      const qr = makeQueryRunner(null, makeMockPayment());
      dataSource.createQueryRunner.mockReturnValue(qr);
      await expect(service.approveRefund('missing-id', 'approver')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws ConflictException when refund is not PENDING_APPROVAL', async () => {
      const refund = makeMockRefund({ status: RefundStatus.EXECUTED });
      const qr = makeQueryRunner(refund, makeMockPayment());
      dataSource.createQueryRunner.mockReturnValue(qr);
      await expect(service.approveRefund('refund-uuid', 'approver')).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws ConflictException when approval window has expired', async () => {
      const refund = makeMockRefund({ expiresAt: new Date(Date.now() - 1000) });
      const qr = makeQueryRunner(refund, makeMockPayment());
      dataSource.createQueryRunner.mockReturnValue(qr);
      await expect(service.approveRefund('refund-uuid', 'approver')).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws ForbiddenException when approver is the initiator (self-approval)', async () => {
      const refund = makeMockRefund({ initiatedBy: 'same-user' });
      const qr = makeQueryRunner(refund, makeMockPayment());
      dataSource.createQueryRunner.mockReturnValue(qr);
      await expect(service.approveRefund('refund-uuid', 'same-user')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('executes refund when approved by a different user', async () => {
      const refund = makeMockRefund();
      const payment = makeMockPayment();
      const qr = makeQueryRunner(refund, payment);
      dataSource.createQueryRunner.mockReturnValue(qr);
      const result = await service.approveRefund('refund-uuid', 'approver-user');
      expect(result.refund.status).toBe(RefundStatus.EXECUTED);
      expect(result.refund.approvedBy).toBe('approver-user');
    });

    it('updates payment status to PARTIALLY_REFUNDED for partial refund', async () => {
      const refund = makeMockRefund({ amount: 50 });
      const payment = makeMockPayment({ amount: 200, refundedAmount: 0 });
      const qr = makeQueryRunner(refund, payment);
      dataSource.createQueryRunner.mockReturnValue(qr);
      const result = await service.approveRefund('refund-uuid', 'approver-user');
      expect(result.payment.status).toBe(PaymentStatus.PARTIALLY_REFUNDED);
    });

    it('updates payment status to REFUNDED for full refund', async () => {
      const refund = makeMockRefund({ amount: 200 });
      const payment = makeMockPayment({ amount: 200, refundedAmount: 0 });
      const qr = makeQueryRunner(refund, payment);
      dataSource.createQueryRunner.mockReturnValue(qr);
      const result = await service.approveRefund('refund-uuid', 'approver-user');
      expect(result.payment.status).toBe(PaymentStatus.REFUNDED);
    });
  });

  describe('rejectRefund', () => {
    it('throws NotFoundException when refund does not exist', async () => {
      refundRepo.findOneBy.mockResolvedValue(null);
      await expect(service.rejectRefund('missing', 'user', {})).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws ConflictException when refund is not PENDING_APPROVAL', async () => {
      refundRepo.findOneBy.mockResolvedValue(makeMockRefund({ status: RefundStatus.EXECUTED }));
      await expect(service.rejectRefund('refund-uuid', 'user', {})).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws ConflictException when approval window has expired', async () => {
      refundRepo.findOneBy.mockResolvedValue(
        makeMockRefund({ expiresAt: new Date(Date.now() - 1000) }),
      );
      await expect(service.rejectRefund('refund-uuid', 'user', {})).rejects.toBeInstanceOf(ConflictException);
    });

    it('marks refund as REJECTED with the provided reason', async () => {
      refundRepo.findOneBy.mockResolvedValue(makeMockRefund());
      paymentRepo.findOneBy.mockResolvedValue(makeMockPayment());
      const dto: RejectRefundDto = { reason: 'Policy violation' };
      const result = await service.rejectRefund('refund-uuid', 'rejector-user', dto);
      expect(result.status).toBe(RefundStatus.REJECTED);
      expect(result.rejectedBy).toBe('rejector-user');
      expect(result.rejectionReason).toBe('Policy violation');
    });
  });

  describe('cancelRefund', () => {
    it('throws NotFoundException when refund does not exist', async () => {
      const qr = makeQueryRunner(null, makeMockPayment());
      dataSource.createQueryRunner.mockReturnValue(qr);
      await expect(service.cancelRefund('missing-id', 'actor-user')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('cancels a refund in PENDING_APPROVAL state and records audit log', async () => {
      const refund = makeMockRefund({ status: RefundStatus.PENDING_APPROVAL, amount: 50 });
      const payment = makeMockPayment({ amount: 200, refundedAmount: 0 });
      const qr = makeQueryRunner(refund, payment);
      dataSource.createQueryRunner.mockReturnValue(qr);

      const result = await service.cancelRefund('refund-uuid', 'actor-user');
      expect(result.refund.status).toBe(RefundStatus.CANCELLED);
      expect(result.refund.cancelledBy).toBe('actor-user');
      expect(result.refund.cancelledAt).toBeInstanceOf(Date);
      expect(result.payment.refundedAmount).toBe(0);
      expect(auditLogsService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'actor-user',
          action: 'refund.cancelled',
          resourceType: 'refund',
          resourceId: 'refund-uuid',
        }),
      );
    });

    it('cancels a pre-submission PENDING refund and restores payment refundable balance & status', async () => {
      const refund = makeMockRefund({
        status: RefundStatus.PENDING,
        amount: 200,
        stellarTransactionHash: null,
      });
      const payment = makeMockPayment({
        amount: 200,
        refundedAmount: 200,
        status: PaymentStatus.REFUNDED,
      });
      const qr = makeQueryRunner(refund, payment);
      dataSource.createQueryRunner.mockReturnValue(qr);

      const result = await service.cancelRefund('refund-uuid', 'actor-user');
      expect(result.refund.status).toBe(RefundStatus.CANCELLED);
      expect(result.payment.refundedAmount).toBe(0);
      expect(result.payment.status).toBe(PaymentStatus.COMPLETED);
    });

    it('restores payment status to PARTIALLY_REFUNDED when another partial refund remains', async () => {
      const refund = makeMockRefund({
        status: RefundStatus.PENDING,
        amount: 100,
        stellarTransactionHash: null,
      });
      const payment = makeMockPayment({
        amount: 200,
        refundedAmount: 200,
        status: PaymentStatus.REFUNDED,
      });
      const qr = makeQueryRunner(refund, payment);
      dataSource.createQueryRunner.mockReturnValue(qr);

      const result = await service.cancelRefund('refund-uuid', 'actor-user');
      expect(result.refund.status).toBe(RefundStatus.CANCELLED);
      expect(result.payment.refundedAmount).toBe(100);
      expect(result.payment.status).toBe(PaymentStatus.PARTIALLY_REFUNDED);
    });

    it('throws ConflictException (409) when PENDING refund already has a stellarTransactionHash', async () => {
      const refund = makeMockRefund({
        status: RefundStatus.PENDING,
        stellarTransactionHash: 'tx-hash-123',
      });
      const qr = makeQueryRunner(refund, makeMockPayment());
      dataSource.createQueryRunner.mockReturnValue(qr);

      await expect(service.cancelRefund('refund-uuid', 'actor-user')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it.each([
      RefundStatus.SUBMITTED,
      RefundStatus.EXECUTED,
      RefundStatus.COMPLETED,
      RefundStatus.CLAIMABLE,
      RefundStatus.FAILED,
      RefundStatus.REJECTED,
      RefundStatus.EXPIRED,
      RefundStatus.CANCELLED,
    ])('throws ConflictException (409) when refund is in %s state', async (status) => {
      const refund = makeMockRefund({ status });
      const qr = makeQueryRunner(refund, makeMockPayment());
      dataSource.createQueryRunner.mockReturnValue(qr);

      await expect(service.cancelRefund('refund-uuid', 'actor-user')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('listRefunds', () => {
    it('scopes by merchant, combines filters, and returns paginated results', async () => {
      const refund = makeMockRefund();
      const query = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[refund], 1]),
      };
      refundRepo.createQueryBuilder.mockReturnValue(query);

      const filters = {
        status: 'EXECUTED',
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-01-31T23:59:59.999Z',
        paymentId: 'payment-uuid',
        reasonCode: RefundReasonCode.OTHER,
        page: 2,
        limit: 5,
      };

      await expect(service.listRefunds('merchant-uuid', filters)).resolves.toEqual({
        data: [refund],
        total: 1,
        page: 2,
        limit: 5,
      });
      expect(query.where).toHaveBeenCalledWith(
        'payment.merchantId = :merchantId',
        { merchantId: 'merchant-uuid' },
      );
      expect(query.andWhere).toHaveBeenCalledTimes(5);
      expect(query.skip).toHaveBeenCalledWith(5);
      expect(query.take).toHaveBeenCalledWith(5);
    });
  });
});
