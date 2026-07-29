import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { PaymentsService } from './payments.service';
import { Payment, PaymentStatus } from './payment.entity';
import { Refund } from './refund.entity';
import { PaymentSplit } from './payment-split.entity';
import { MerchantFeeConfig } from './merchant-fee-config.entity';
import { AppLogger } from '../logger/logger.service';
import { PaymentSseService } from './payment-sse.service';
import { EmailNotificationService } from '../notifications/email-notification.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { StellarService } from '../stellar/stellar.service';
import { UsersService } from '../users/users.service';
import { DataSource } from 'typeorm';

describe('PaymentsService - Batch Payment Expiration', () => {
  let service: PaymentsService;
  let paymentRepository: Repository<Payment>;
  let configService: ConfigService;
  let logger: any;

  const mockQueryRunner = {
    connect: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    release: jest.fn(),
    manager: {
      create: jest.fn(),
      save: jest.fn(),
    },
  };

  beforeEach(async () => {
    const loggerChild = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        {
          provide: getRepositoryToken(Payment),
          useValue: {
            find: jest.fn(),
            save: jest.fn(),
            createQueryBuilder: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(Refund),
          useValue: {},
        },
        {
          provide: getRepositoryToken(MerchantFeeConfig),
          useValue: {},
        },
        {
          provide: getRepositoryToken(PaymentSplit),
          useValue: {},
        },
        {
          provide: DataSource,
          useValue: {
            createQueryRunner: jest.fn(() => mockQueryRunner),
          },
        },
        {
          provide: AppLogger,
          useValue: {
            child: jest.fn(() => loggerChild),
          },
        },
        {
          provide: PaymentSseService,
          useValue: {
            emit: jest.fn(),
          },
        },
        {
          provide: EmailNotificationService,
          useValue: {},
        },
        {
          provide: WebhooksService,
          useValue: {
            dispatchEventToMerchant: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: any) => {
              if (key === 'PAYMENT_EXPIRY_BATCH_SIZE') return 100;
              return defaultValue || 0;
            }),
          },
        },
        {
          provide: StellarService,
          useValue: {},
        },
        {
          provide: UsersService,
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
    paymentRepository = module.get(getRepositoryToken(Payment));
    configService = module.get<ConfigService>(ConfigService);
    logger = module.get<AppLogger>(AppLogger).child({});
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('expirePendingPayments', () => {
    it('should process payments in bounded batches', async () => {
      // Create 150 expired payments (exceeds batch size of 100)
      const expiredPayments = Array.from({ length: 150 }, (_, i) => ({
        id: `payment-${i}`,
        status: PaymentStatus.PENDING,
        expiresAt: new Date(Date.now() - 1000),
        amount: 100,
        currency: 'USD',
      }));

      // Mock will return only first 100 (batch size)
      jest
        .spyOn(paymentRepository, 'find')
        .mockResolvedValue(expiredPayments.slice(0, 100) as any);

      jest.spyOn(paymentRepository, 'save').mockImplementation((payment: any) => {
        return Promise.resolve({ ...payment, status: PaymentStatus.EXPIRED });
      });

      await service.expirePendingPayments();

      expect(paymentRepository.find).toHaveBeenCalledWith({
        where: expect.objectContaining({
          status: PaymentStatus.PENDING,
        }),
        take: 100, // Batch size limit
        order: {
          expiresAt: 'ASC',
        },
      });

      // Should process exactly 100 payments
      expect(paymentRepository.save).toHaveBeenCalledTimes(100);
      expect(logger.info).toHaveBeenCalledWith(
        'Processing 100 expired payments (batch limit: 100)',
      );
      expect(logger.warn).toHaveBeenCalledWith(
        'Processed full batch of 100 payments. More expired payments may be pending.',
      );
    });

    it('should not warn if batch is not full', async () => {
      const expiredPayments = Array.from({ length: 50 }, (_, i) => ({
        id: `payment-${i}`,
        status: PaymentStatus.PENDING,
        expiresAt: new Date(Date.now() - 1000),
        amount: 100,
        currency: 'USD',
      }));

      jest.spyOn(paymentRepository, 'find').mockResolvedValue(expiredPayments as any);
      jest.spyOn(paymentRepository, 'save').mockImplementation((payment: any) => {
        return Promise.resolve({ ...payment, status: PaymentStatus.EXPIRED });
      });

      await service.expirePendingPayments();

      expect(logger.info).toHaveBeenCalledWith(
        'Processing 50 expired payments (batch limit: 100)',
      );
      expect(logger.info).toHaveBeenCalledWith('Successfully expired 50 payments');
      // Should NOT warn about full batch
      expect(logger.warn).not.toHaveBeenCalledWith(
        expect.stringContaining('Processed full batch'),
      );
    });

    it('should handle processing failures gracefully', async () => {
      const expiredPayments = [
        {
          id: 'payment-1',
          status: PaymentStatus.PENDING,
          expiresAt: new Date(Date.now() - 1000),
          amount: 100,
          currency: 'USD',
        },
        {
          id: 'payment-2',
          status: PaymentStatus.PENDING,
          expiresAt: new Date(Date.now() - 2000),
          amount: 200,
          currency: 'USD',
        },
        {
          id: 'payment-3',
          status: PaymentStatus.PENDING,
          expiresAt: new Date(Date.now() - 3000),
          amount: 300,
          currency: 'USD',
        },
      ];

      jest.spyOn(paymentRepository, 'find').mockResolvedValue(expiredPayments as any);

      // Mock save to fail on second payment
      jest
        .spyOn(paymentRepository, 'save')
        .mockImplementation((payment: any) => {
          if (payment.id === 'payment-2') {
            return Promise.reject(new Error('Database error'));
          }
          return Promise.resolve({ ...payment, status: PaymentStatus.EXPIRED });
        });

      await service.expirePendingPayments();

      // Should still process other payments
      expect(paymentRepository.save).toHaveBeenCalledTimes(3);
      expect(logger.warn).toHaveBeenCalledWith(
        'Expired 2 payments successfully, 1 failed',
      );
    });

    it('should return early if no expired payments found', async () => {
      jest.spyOn(paymentRepository, 'find').mockResolvedValue([]);
      jest.spyOn(paymentRepository, 'save');

      await service.expirePendingPayments();

      expect(paymentRepository.save).not.toHaveBeenCalled();
      expect(logger.info).not.toHaveBeenCalled();
    });

    it('should process payments in parallel for better performance', async () => {
      const expiredPayments = Array.from({ length: 10 }, (_, i) => ({
        id: `payment-${i}`,
        status: PaymentStatus.PENDING,
        expiresAt: new Date(Date.now() - 1000),
        amount: 100,
        currency: 'USD',
      }));

      jest.spyOn(paymentRepository, 'find').mockResolvedValue(expiredPayments as any);

      const saveTimes: number[] = [];
      jest.spyOn(paymentRepository, 'save').mockImplementation((payment: any) => {
        saveTimes.push(Date.now());
        return Promise.resolve({ ...payment, status: PaymentStatus.EXPIRED });
      });

      await service.expirePendingPayments();

      // All saves should happen roughly at the same time (parallel)
      // Check that all timestamps are within 100ms of each other
      const minTime = Math.min(...saveTimes);
      const maxTime = Math.max(...saveTimes);
      expect(maxTime - minTime).toBeLessThan(100);
    });

    it('should use configurable batch size', async () => {
      // Change config to return different batch size
      jest.spyOn(configService, 'get').mockImplementation((key: string, defaultValue?: any) => {
        if (key === 'PAYMENT_EXPIRY_BATCH_SIZE') return 50;
        return defaultValue || 0;
      });

      const expiredPayments = Array.from({ length: 50 }, (_, i) => ({
        id: `payment-${i}`,
        status: PaymentStatus.PENDING,
        expiresAt: new Date(Date.now() - 1000),
      }));

      jest.spyOn(paymentRepository, 'find').mockResolvedValue(expiredPayments as any);
      jest.spyOn(paymentRepository, 'save').mockResolvedValue({} as any);

      await service.expirePendingPayments();

      expect(paymentRepository.find).toHaveBeenCalledWith({
        where: expect.any(Object),
        take: 50, // Custom batch size
        order: expect.any(Object),
      });
    });

    it('should process oldest payments first', async () => {
      const now = Date.now();
      const expiredPayments = [
        {
          id: 'payment-new',
          expiresAt: new Date(now - 1000),
          status: PaymentStatus.PENDING,
        },
        {
          id: 'payment-old',
          expiresAt: new Date(now - 10000),
          status: PaymentStatus.PENDING,
        },
      ];

      jest.spyOn(paymentRepository, 'find').mockResolvedValue(expiredPayments as any);
      jest.spyOn(paymentRepository, 'save').mockResolvedValue({} as any);

      await service.expirePendingPayments();

      expect(paymentRepository.find).toHaveBeenCalledWith({
        where: expect.any(Object),
        take: expect.any(Number),
        order: {
          expiresAt: 'ASC', // Oldest first
        },
      });
    });
  });
});
