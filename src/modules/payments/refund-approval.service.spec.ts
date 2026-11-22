import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { PaymentsService } from './payments.service';
import { Refund, RefundStatus, RefundReasonCode } from './refund.entity';
import { Payment, PaymentStatus } from './payment.entity';
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
    approvedBy: null,
    approvedAt: null,
    rejectedBy: null,
    rejectedAt: null,
    rejectionReason: null,
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

const makeQueryRunner = (refund: Refund, payment: Payment) => ({
  connect: jest.fn(),
  startTransaction: jest.fn(),
  commitTransaction: jest.fn(),
  rollbackTransaction: jest.fn(),
  release: jest.fn(),
  manager: {
    findOneBy: jest.fn().mockImplementation((entity, where) => {
      if (entity === Refund) return Promise.resolve(refund);
      if (entity === Payment) return Promise.resolve(payment);
      return Promise.resolve(null);
    }),
    save: jest.fn().mockImplementation((v) => Promise.resolve(v)),
    create: jest.fn().mockImplementation((_, v) => v),
  },
});

describe('PaymentsService — maker-checker refund approval', () => {
  let service: PaymentsService;
  let refundRepo: { findOneBy: jest.Mock; save: jest.Mock; createQueryBuilder: jest.Mock };
  let paymentRepo: { findOneBy: jest.Mock };
  let dataSource: { createQueryRunner: jest.Mock };

  const buildModule = async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: getRepositoryToken(Refund), useValue: refundRepo },
        { provide: getRepositoryToken(Payment), useValue: paymentRepo },
        { provide: getRepositoryToken('MerchantFeeConfig'), useValue: { findOneBy: jest.fn() } },
        { provide: getRepositoryToken('PaymentSplit'), useValue: {} },
        { provide: getRepositoryToken('Dispute'), useValue: {} },
        { provide: getRepositoryToken('SettlementAdjustment'), useValue: {} },
        { provide: getRepositoryToken('MerchantSettings'), useValue: { findOneBy: jest.fn() } },
        { provide: DataSource, useValue: dataSource },
        { provide: 'AppLogger', useValue: { child: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }) } },
        { provide: 'PaymentSseService', useValue: { emit: jest.fn() } },
        { provide: 'EmailNotificationService', useValue: { sendRefundApprovalOutcome: jest.fn(), sendRefundNotifications: jest.fn(), sendMerchantRefundIssued: jest.fn(), sendPayerRefundProcessed: jest.fn() } },
        { provide: 'WebhooksService', useValue: { dispatchEventToMerchant: jest.fn().mockResolvedValue(undefined) } },
        { provide: 'ConfigService', useValue: { get: jest.fn() } },
        { provide: 'StellarService', useValue: {} },
        { provide: 'UsersService', useValue: {} },
        { provide: 'PaymentLinksService', useValue: {} },
        { provide: 'EventsService', useValue: { emit: jest.fn() } },
        { provide: 'AuditLogsService', useValue: { record: jest.fn().mockResolvedValue({}) } },
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
    await buildModule();
  });

  describe('approveRefund', () => {
    it('throws NotFoundException when refund does not exist', async () => {
      const qr = makeQueryRunner(null as any, makeMockPayment());
      qr.manager.findOneBy.mockResolvedValue(null);
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
