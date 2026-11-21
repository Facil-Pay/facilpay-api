import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { UnmatchedTransactionsService } from './unmatched-transactions.service';
import {
  UnmatchedTransaction,
  UnmatchedTransactionStatus,
} from './entities/unmatched-transaction.entity';
import { Payment, PaymentStatus } from '../payments/payment.entity';
import { EventsService } from '../events/events.service';
import { AppLogger } from '../logger/logger.service';

jest.mock('../logger/logger.service', () => ({
  AppLogger: class AppLogger {
    child() {
      return { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    }
  },
}));

jest.mock('../events/events.service');

function makeRepo(overrides: Partial<Record<string, jest.Mock>> = {}) {
  return {
    findOneBy: jest.fn(),
    find: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    createQueryBuilder: jest.fn(),
    ...overrides,
  };
}

/** Fresh objects to prevent cross-test mutation */
const makePendingRecord = () => ({
  id: 'ut-1',
  status: UnmatchedTransactionStatus.PENDING,
  transactionHash: 'abc123',
});

const makePendingPayment = () => ({
  id: 'pay-1',
  status: PaymentStatus.PENDING,
  merchantId: 'm1',
  externalReference: null,
});

describe('UnmatchedTransactionsService', () => {
  let service: UnmatchedTransactionsService;
  let unmatchedRepo: ReturnType<typeof makeRepo>;
  let paymentRepo: ReturnType<typeof makeRepo>;
  let eventsService: { emit: jest.Mock };
  let dataSource: { transaction: jest.Mock };

  beforeEach(async () => {
    unmatchedRepo = makeRepo();
    paymentRepo = makeRepo();
    eventsService = { emit: jest.fn() };
    dataSource = { transaction: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UnmatchedTransactionsService,
        { provide: getRepositoryToken(UnmatchedTransaction), useValue: unmatchedRepo },
        { provide: getRepositoryToken(Payment), useValue: paymentRepo },
        { provide: EventsService, useValue: eventsService },
        { provide: DataSource, useValue: dataSource },
        { provide: AppLogger, useValue: new AppLogger() },
      ],
    }).compile();

    service = module.get(UnmatchedTransactionsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── store() ────────────────────────────────────────────────────────────────

  describe('store()', () => {
    const input = {
      transactionHash: 'abc123',
      fromAddress: 'GABC',
      amount: '10.0000000',
      assetCode: 'XLM',
      memo: null,
    };

    it('persists a new unmatched transaction and emits the event', async () => {
      unmatchedRepo.findOneBy.mockResolvedValue(null);
      const created = { id: 'ut-1', ...input, status: UnmatchedTransactionStatus.PENDING };
      unmatchedRepo.create.mockReturnValue(created);
      unmatchedRepo.save.mockResolvedValue(created);

      const result = await service.store(input);

      expect(unmatchedRepo.save).toHaveBeenCalledWith(created);
      expect(eventsService.emit).toHaveBeenCalledWith(
        null,
        'transaction.unmatched',
        expect.objectContaining({ transactionHash: 'abc123' }),
      );
      expect(result).toBe(created);
    });

    it('returns the existing record when the hash is a duplicate', async () => {
      const existing = { id: 'ut-existing', ...input };
      unmatchedRepo.findOneBy.mockResolvedValue(existing);

      const result = await service.store(input);

      expect(unmatchedRepo.create).not.toHaveBeenCalled();
      expect(eventsService.emit).not.toHaveBeenCalled();
      expect(result).toBe(existing);
    });
  });

  // ── findOne() ──────────────────────────────────────────────────────────────

  describe('findOne()', () => {
    it('throws NotFoundException when record does not exist', async () => {
      unmatchedRepo.findOneBy.mockResolvedValue(null);
      await expect(service.findOne('missing-id')).rejects.toThrow(NotFoundException);
    });

    it('returns the record when found', async () => {
      const record = { id: 'ut-1' };
      unmatchedRepo.findOneBy.mockResolvedValue(record);
      await expect(service.findOne('ut-1')).resolves.toBe(record);
    });
  });

  // ── match() ───────────────────────────────────────────────────────────────

  describe('match()', () => {
    function setupTransactionMock(record: any, payment: any) {
      dataSource.transaction.mockImplementation(async (cb: (em: EntityManager) => any) => {
        const em = {
          findOne: jest.fn()
            .mockResolvedValueOnce(record)    // first call → UnmatchedTransaction
            .mockResolvedValueOnce(payment),  // second call → Payment
          save: jest.fn().mockImplementation((_entity: any, data: any) => Promise.resolve(data)),
        };
        return cb(em as unknown as EntityManager);
      });
    }

    it('completes the payment and marks the record as MATCHED', async () => {
      setupTransactionMock(makePendingRecord(), makePendingPayment());

      const result = await service.match('ut-1', { paymentId: 'pay-1' }, 'user-99');

      expect(result.status).toBe(UnmatchedTransactionStatus.MATCHED);
      expect(result.matchedPaymentId).toBe('pay-1');
      expect(result.resolvedBy).toBe('user-99');
      expect(eventsService.emit).toHaveBeenCalledWith(
        'm1',
        'transaction.matched',
        expect.objectContaining({ unmatchedTransactionId: 'ut-1', paymentId: 'pay-1' }),
      );
    });

    it('throws NotFoundException when the unmatched record is missing', async () => {
      setupTransactionMock(null, makePendingPayment());
      await expect(service.match('ut-1', { paymentId: 'pay-1' }, 'user-99')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ConflictException when the transaction is already resolved', async () => {
      setupTransactionMock(
        { ...makePendingRecord(), status: UnmatchedTransactionStatus.MATCHED },
        makePendingPayment(),
      );
      await expect(service.match('ut-1', { paymentId: 'pay-1' }, 'user-99')).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws NotFoundException when the payment does not exist', async () => {
      setupTransactionMock(makePendingRecord(), null);
      await expect(service.match('ut-1', { paymentId: 'pay-1' }, 'user-99')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException when the payment is not PENDING', async () => {
      setupTransactionMock(
        makePendingRecord(),
        { ...makePendingPayment(), status: PaymentStatus.COMPLETED },
      );
      await expect(service.match('ut-1', { paymentId: 'pay-1' }, 'user-99')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ── markRefunded() ────────────────────────────────────────────────────────

  describe('markRefunded()', () => {
    function setupTransactionMock(record: any) {
      dataSource.transaction.mockImplementation(async (cb: (em: EntityManager) => any) => {
        const em = {
          findOne: jest.fn().mockResolvedValue(record),
          save: jest.fn().mockImplementation((_entity: any, data: any) => Promise.resolve(data)),
        };
        return cb(em as unknown as EntityManager);
      });
    }

    it('marks the record as REFUNDED', async () => {
      setupTransactionMock(makePendingRecord());
      const result = await service.markRefunded('ut-1', 'user-99');
      expect(result.status).toBe(UnmatchedTransactionStatus.REFUNDED);
      expect(result.resolvedBy).toBe('user-99');
    });

    it('throws NotFoundException when the record is missing', async () => {
      setupTransactionMock(null);
      await expect(service.markRefunded('ut-1', 'user-99')).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when already resolved', async () => {
      setupTransactionMock({ ...makePendingRecord(), status: UnmatchedTransactionStatus.REFUNDED });
      await expect(service.markRefunded('ut-1', 'user-99')).rejects.toThrow(ConflictException);
    });
  });
});
