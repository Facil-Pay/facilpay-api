import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { PaymentsService } from './payments.service';
import { Payment } from './payment.entity';
import { Refund } from './refund.entity';
import { PaymentSplit } from './payment-split.entity';
import { MerchantFeeConfig } from './merchant-fee-config.entity';
import { UsersService } from '../users/users.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { AppLogger } from '../logger/logger.service';
import { PaymentSseService } from './payment-sse.service';
import { EmailNotificationService } from '../notifications/email-notification.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { StellarService } from '../stellar/stellar.service';

describe('PaymentsService - MerchantId Validation', () => {
  let service: PaymentsService;
  let usersService: UsersService;
  let dataSource: DataSource;

  const mockQueryRunner = {
    connect: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    release: jest.fn(),
    manager: {
      create: jest.fn(),
      save: jest.fn(),
      findOneBy: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        {
          provide: getRepositoryToken(Payment),
          useValue: {
            find: jest.fn(),
            findOneBy: jest.fn(),
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
          useValue: {
            findOneBy: jest.fn(),
          },
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
            child: jest.fn(() => ({
              debug: jest.fn(),
              info: jest.fn(),
              warn: jest.fn(),
              error: jest.fn(),
            })),
          },
        },
        {
          provide: PaymentSseService,
          useValue: {},
        },
        {
          provide: EmailNotificationService,
          useValue: {},
        },
        {
          provide: WebhooksService,
          useValue: {},
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: any) => {
              if (key === 'PAYMENT_DEFAULT_EXPIRY_SECONDS') return 1800;
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
          useValue: {
            findOne: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
    usersService = module.get<UsersService>(UsersService);
    dataSource = module.get<DataSource>(DataSource);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create - merchantId validation', () => {
    const validPaymentDto: CreatePaymentDto = {
      amount: 100,
      currency: 'USD',
      merchantId: 'valid-merchant-id',
    };

    it('should create payment successfully with valid merchantId', async () => {
      const mockUser = { id: 'valid-merchant-id', email: 'merchant@test.com' };
      jest.spyOn(usersService, 'findOne').mockResolvedValue(mockUser as any);

      const mockPayment = { id: 'payment-1', ...validPaymentDto };
      mockQueryRunner.manager.create.mockReturnValue(mockPayment);
      mockQueryRunner.manager.save.mockResolvedValue(mockPayment);

      const result = await service.create(validPaymentDto);

      expect(usersService.findOne).toHaveBeenCalledWith('valid-merchant-id');
      expect(result).toEqual(mockPayment);
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
    });

    it('should throw BadRequestException for non-existent merchantId', async () => {
      const invalidPaymentDto: CreatePaymentDto = {
        amount: 100,
        currency: 'USD',
        merchantId: 'non-existent-merchant',
      };

      jest
        .spyOn(usersService, 'findOne')
        .mockRejectedValue(
          new NotFoundException('User with ID non-existent-merchant not found'),
        );

      await expect(service.create(invalidPaymentDto)).rejects.toThrow(BadRequestException);
      await expect(service.create(invalidPaymentDto)).rejects.toThrow(
        "Invalid merchantId: merchant with ID 'non-existent-merchant' does not exist",
      );

      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
    });

    it('should create payment successfully without merchantId', async () => {
      const paymentDtoWithoutMerchant: CreatePaymentDto = {
        amount: 100,
        currency: 'USD',
      };

      const mockPayment = { id: 'payment-2', ...paymentDtoWithoutMerchant };
      mockQueryRunner.manager.create.mockReturnValue(mockPayment);
      mockQueryRunner.manager.save.mockResolvedValue(mockPayment);

      const result = await service.create(paymentDtoWithoutMerchant);

      // Should not call usersService.findOne when merchantId is undefined
      expect(usersService.findOne).not.toHaveBeenCalled();
      expect(result).toEqual(mockPayment);
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
    });

    it('should throw BadRequestException with typo in merchantId', async () => {
      const typoPaymentDto: CreatePaymentDto = {
        amount: 100,
        currency: 'USD',
        merchantId: 'merchant-id-typo',
      };

      jest
        .spyOn(usersService, 'findOne')
        .mockRejectedValue(
          new NotFoundException('User with ID merchant-id-typo not found'),
        );

      await expect(service.create(typoPaymentDto)).rejects.toThrow(BadRequestException);
      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
    });
  });

  describe('createBulk - merchantId validation', () => {
    it('should validate all unique merchantIds before creating payments', async () => {
      const bulkPayments: CreatePaymentDto[] = [
        { amount: 100, currency: 'USD', merchantId: 'merchant-1' },
        { amount: 200, currency: 'USD', merchantId: 'merchant-2' },
        { amount: 150, currency: 'USD', merchantId: 'merchant-1' }, // duplicate
      ];

      const mockUser1 = { id: 'merchant-1', email: 'merchant1@test.com' };
      const mockUser2 = { id: 'merchant-2', email: 'merchant2@test.com' };

      jest
        .spyOn(usersService, 'findOne')
        .mockImplementation((id: string) => {
          if (id === 'merchant-1') return Promise.resolve(mockUser1 as any);
          if (id === 'merchant-2') return Promise.resolve(mockUser2 as any);
          return Promise.reject(new NotFoundException(`User with ID ${id} not found`));
        });

      mockQueryRunner.manager.create.mockReturnValue({});
      mockQueryRunner.manager.save.mockResolvedValue([{}, {}, {}]);

      await service.createBulk(bulkPayments);

      // Should validate both unique merchant IDs
      expect(usersService.findOne).toHaveBeenCalledTimes(2);
      expect(usersService.findOne).toHaveBeenCalledWith('merchant-1');
      expect(usersService.findOne).toHaveBeenCalledWith('merchant-2');
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
    });

    it('should reject bulk creation if any merchantId is invalid', async () => {
      const bulkPayments: CreatePaymentDto[] = [
        { amount: 100, currency: 'USD', merchantId: 'valid-merchant' },
        { amount: 200, currency: 'USD', merchantId: 'invalid-merchant' },
      ];

      jest
        .spyOn(usersService, 'findOne')
        .mockImplementation((id: string) => {
          if (id === 'valid-merchant')
            return Promise.resolve({ id, email: 'valid@test.com' } as any);
          return Promise.reject(new NotFoundException(`User with ID ${id} not found`));
        });

      await expect(service.createBulk(bulkPayments)).rejects.toThrow(BadRequestException);
      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
    });
  });
});
