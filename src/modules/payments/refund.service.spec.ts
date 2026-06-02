import { Test, TestingModule } from '@nestjs/testing';
import { PaymentsService } from './payments.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Payment, PaymentStatus } from './payment.entity';
import { Refund } from './refund.entity';
import { DataSource } from 'typeorm';
import { AppLogger } from '../logger/logger.service';
import { IdempotencyService } from './idempotency.service';
import {
  NotFoundException,
  ConflictException,
} from '@nestjs/common';

describe('PaymentsService - Refunds', () => {
  let service: PaymentsService;
  let mockPaymentRepository: any;
  let mockRefundRepository: any;
  let mockDataSource: any;
  let mockQueryRunner: any;

  beforeEach(async () => {
    mockQueryRunner = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      manager: {
        findOneBy: jest.fn(),
        create: jest.fn(),
        save: jest.fn(),
      },
    };

    mockDataSource = {
      createQueryRunner: jest.fn().mockReturnValue(mockQueryRunner),
    };

    mockPaymentRepository = {
      findOneBy: jest.fn(),
    };

    mockRefundRepository = {
      find: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        {
          provide: getRepositoryToken(Payment),
          useValue: mockPaymentRepository,
        },
        {
          provide: getRepositoryToken(Refund),
          useValue: mockRefundRepository,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: AppLogger,
          useValue: {
            child: jest.fn().mockReturnValue({
              info: jest.fn(),
              error: jest.fn(),
              debug: jest.fn(),
            }),
          },
        },
        {
          provide: IdempotencyService,
          useValue: {
            checkIdempotencyKey: jest.fn().mockResolvedValue(null),
            storeIdempotencyKey: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
  });

  describe('refund', () => {
    it('should process full refund and set status to REFUNDED', async () => {
      const payment = {
        id: '123',
        amount: 100,
        refundedAmount: 0,
        status: PaymentStatus.COMPLETED,
      };

      mockQueryRunner.manager.findOneBy.mockResolvedValue(payment);
      mockQueryRunner.manager.create.mockReturnValue({
        paymentId: '123',
        amount: 100,
      });
      mockQueryRunner.manager.save
        .mockResolvedValueOnce({ id: 'refund-1', amount: 100 })
        .mockResolvedValueOnce({
          ...payment,
          refundedAmount: 100,
          status: PaymentStatus.REFUNDED,
        });

      const result = await service.refund('123', {});

      expect(result.payment.status).toBe(PaymentStatus.REFUNDED);
      expect(result.payment.refundedAmount).toBe(100);
      expect(result.refund.amount).toBe(100);
    });

    it('should process partial refund and set status to PARTIALLY_REFUNDED', async () => {
      const payment = {
        id: '123',
        amount: 100,
        refundedAmount: 0,
        status: PaymentStatus.COMPLETED,
      };

      mockQueryRunner.manager.findOneBy.mockResolvedValue(payment);
      mockQueryRunner.manager.create.mockReturnValue({
        paymentId: '123',
        amount: 50,
      });
      mockQueryRunner.manager.save
        .mockResolvedValueOnce({ id: 'refund-1', amount: 50 })
        .mockResolvedValueOnce({
          ...payment,
          refundedAmount: 50,
          status: PaymentStatus.PARTIALLY_REFUNDED,
        });

      const result = await service.refund('123', { amount: 50 });

      expect(result.payment.status).toBe(PaymentStatus.PARTIALLY_REFUNDED);
      expect(result.payment.refundedAmount).toBe(50);
    });

    it('should throw NotFoundException for non-existent payment', async () => {
      mockQueryRunner.manager.findOneBy.mockResolvedValue(null);

      await expect(service.refund('999', {})).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ConflictException for PENDING payment', async () => {
      mockQueryRunner.manager.findOneBy.mockResolvedValue({
        id: '123',
        status: PaymentStatus.PENDING,
      });

      await expect(service.refund('123', {})).rejects.toThrow(
        ConflictException,
      );
    });

    it('should throw ConflictException for already REFUNDED payment', async () => {
      mockQueryRunner.manager.findOneBy.mockResolvedValue({
        id: '123',
        status: PaymentStatus.REFUNDED,
      });

      await expect(service.refund('123', {})).rejects.toThrow(
        ConflictException,
      );
    });

    it('should throw ConflictException when refund exceeds remaining amount', async () => {
      mockQueryRunner.manager.findOneBy.mockResolvedValue({
        id: '123',
        amount: 100,
        refundedAmount: 80,
        status: PaymentStatus.PARTIALLY_REFUNDED,
      });

      await expect(service.refund('123', { amount: 50 })).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('getRefunds', () => {
    it('should return refunds for a payment', async () => {
      const refunds = [
        { id: 'r1', amount: 50, paymentId: '123' },
        { id: 'r2', amount: 30, paymentId: '123' },
      ];

      mockRefundRepository.find.mockResolvedValue(refunds);

      const result = await service.getRefunds('123');

      expect(result).toEqual(refunds);
      expect(mockRefundRepository.find).toHaveBeenCalledWith({
        where: { paymentId: '123' },
        order: { createdAt: 'DESC' },
      });
    });
  });
});
