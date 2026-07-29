import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { PaymentsService } from './payments.service';
import { Payment, PaymentStatus } from './payment.entity';
import { Refund } from './refund.entity';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { AppLogger } from '../logger/logger.service';
import { IdempotencyService } from './idempotency.service';
import { EmailNotificationService } from '../notifications/email-notification.service';
import { PaymentSplit } from './payment-split.entity';
import { MerchantFeeConfig } from './merchant-fee-config.entity';
import { WebhooksService } from '../webhooks/webhooks.service';
import { StellarService } from '../stellar/stellar.service';
import { ConfigService } from '@nestjs/config';
import { PaymentSseService } from './payment-sse.service';
import { GetPaymentsDto, PaymentSortBy } from './dto/get-payments.dto';
import { SortOrder } from '../../common/dto/pagination.dto';

describe('PaymentsService', () => {
  let service: PaymentsService;
  let repository: Repository<Payment>;
  let merchantFeeConfigRepository: Repository<MerchantFeeConfig>;
  let dataSource: DataSource;

  const baseDate = new Date('2026-01-26T10:00:00.000Z');

  const mockPayment1 = {
    id: 'uuid-001',
    amount: 50.0,
    currency: 'USD',
    status: PaymentStatus.PENDING,
    description: 'First payment',
    externalReference: null,
    refundedAmount: 0,
    cancelledAt: null,
    metadata: null,
    createdAt: new Date(baseDate.getTime() + 1000),
    updatedAt: new Date(),
  };

  const mockPayment2 = {
    id: 'uuid-002',
    amount: 100.5,
    currency: 'USD',
    status: PaymentStatus.COMPLETED,
    description: 'Second payment',
    externalReference: 'ext-002',
    refundedAmount: 0,
    cancelledAt: null,
    metadata: null,
    createdAt: new Date(baseDate.getTime() + 2000),
    updatedAt: new Date(),
  };

  const mockPayment3 = {
    id: 'uuid-003',
    amount: 200.0,
    currency: 'EUR',
    status: PaymentStatus.FAILED,
    description: 'Third payment',
    externalReference: null,
    refundedAmount: 0,
    cancelledAt: null,
    metadata: null,
    createdAt: new Date(baseDate.getTime() + 3000),
    updatedAt: new Date(),
  };

  let queryBuilderMock: any;

  const createQueryBuilderMock = () => {
    const qb: any = {};
    qb.andWhere = jest.fn().mockReturnValue(qb);
    qb.orderBy = jest.fn().mockReturnValue(qb);
    qb.addOrderBy = jest.fn().mockReturnValue(qb);
    qb.skip = jest.fn().mockReturnValue(qb);
    qb.take = jest.fn().mockReturnValue(qb);
    qb.getMany = jest.fn().mockResolvedValue([mockPayment1, mockPayment2]);
    qb.getManyAndCount = jest.fn().mockResolvedValue([[mockPayment1, mockPayment2], 2]);
    return qb;
  };

  const mockPaymentRepository = {
    create: jest.fn().mockImplementation((dto) => dto as Payment),
    save: jest.fn().mockImplementation((payment) =>
      Promise.resolve({
        id: 'uuid-123',
        ...payment,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ),
    find: jest.fn().mockResolvedValue([mockPayment1]),
    findOneBy: jest.fn().mockResolvedValue(mockPayment1),
    createQueryBuilder: jest.fn(),
  };

  const mockDataSource = {
    createQueryRunner: jest.fn(),
  };

  const mockAppLogger = {
    child: jest.fn(() => ({
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
    })),
  };

  const mockIdempotencyService = {
    checkIdempotencyKey: jest.fn().mockResolvedValue(null),
    storeIdempotencyKey: jest.fn().mockResolvedValue(undefined),
  };

  const mockPaymentSseService = {
    subscribe: jest.fn(),
    emit: jest.fn(),
  };

  beforeEach(async () => {
    queryBuilderMock = createQueryBuilderMock();
    mockPaymentRepository.createQueryBuilder.mockReturnValue(queryBuilderMock);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        {
          provide: getRepositoryToken(Payment),
          useValue: mockPaymentRepository,
        },
        {
          provide: getRepositoryToken(Refund),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            find: jest.fn(),
            findOneBy: jest.fn(),
          },
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: AppLogger,
          useValue: mockAppLogger,
        },
        {
          provide: IdempotencyService,
          useValue: mockIdempotencyService,
        },
        {
          provide: EmailNotificationService,
          useValue: { sendMerchantPaymentReceived: jest.fn(), sendPayerPaymentConfirmed: jest.fn(), sendMerchantRefundIssued: jest.fn(), sendPayerRefundProcessed: jest.fn() },
        },
        {
          provide: getRepositoryToken(PaymentSplit),
          useValue: { create: jest.fn(), save: jest.fn(), find: jest.fn(), findOneBy: jest.fn() },
        },
        {
          provide: getRepositoryToken(MerchantFeeConfig),
          useValue: { create: jest.fn(), save: jest.fn(), find: jest.fn(), findOneBy: jest.fn() },
        },
        {
          provide: PaymentSseService,
          useValue: mockPaymentSseService,
        },
        {
          provide: WebhooksService,
          useValue: { dispatchEventToMerchant: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: StellarService,
          useValue: { sendPayment: jest.fn() },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn((_key, defaultValue) => defaultValue) },
        },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
    repository = module.get<Repository<Payment>>(getRepositoryToken(Payment));
    merchantFeeConfigRepository = module.get<Repository<MerchantFeeConfig>>(
      getRepositoryToken(MerchantFeeConfig),
    );
    dataSource = module.get<DataSource>(DataSource);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should successfully create a payment using transactions', async () => {
      const dto = {
        amount: 100.5,
        currency: 'USD',
        description: 'Test payment',
      };

      const mockQueryRunner = {
        connect: jest.fn(),
        startTransaction: jest.fn(),
        commitTransaction: jest.fn(),
        rollbackTransaction: jest.fn(),
        release: jest.fn(),
        manager: {
          create: jest
            .fn()
            .mockReturnValue({ ...mockPayment1, status: PaymentStatus.PENDING }),
          save: jest.fn().mockResolvedValue({ ...mockPayment1 }),
        },
      };

      (dataSource.createQueryRunner as jest.Mock).mockReturnValue(
        mockQueryRunner,
      );

      const result = await service.create(dto);

      expect(mockQueryRunner.connect).toHaveBeenCalled();
      expect(mockQueryRunner.startTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.manager.create).toHaveBeenCalled();
      expect(mockQueryRunner.manager.save).toHaveBeenCalled();
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();
      expect(result.id).toEqual('uuid-123');
    });

    it('should rollback transaction on creation failure', async () => {
      const dto = {
        amount: 100.5,
        currency: 'USD',
        description: 'Test payment',
      };

      const error = new Error('Database error');

      const mockQueryRunner = {
        connect: jest.fn(),
        startTransaction: jest.fn(),
        commitTransaction: jest.fn(),
        rollbackTransaction: jest.fn(),
        release: jest.fn(),
        manager: {
          create: jest
            .fn()
            .mockReturnValue({ ...mockPayment1, status: PaymentStatus.PENDING }),
          save: jest.fn().mockRejectedValue(error),
        },
      };

      (dataSource.createQueryRunner as jest.Mock).mockReturnValue(
        mockQueryRunner,
      );

      await expect(service.create(dto)).rejects.toThrow(error);

      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.commitTransaction).not.toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();
    });
  });

  describe('createBulk', () => {
    it('should create multiple payments inside a single transaction', async () => {
      const createDtos = [
        { amount: 50.0, currency: 'USD' },
        { amount: 75.5, currency: 'USD' },
      ];

      const savedPayments = [
        {
          id: 'uuid-1',
          amount: 50.0,
          currency: 'USD',
          status: PaymentStatus.PENDING,
          description: null,
          externalReference: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'uuid-2',
          amount: 75.5,
          currency: 'USD',
          status: PaymentStatus.PENDING,
          description: null,
          externalReference: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      const mockQueryRunner = {
        connect: jest.fn(),
        startTransaction: jest.fn(),
        commitTransaction: jest.fn(),
        rollbackTransaction: jest.fn(),
        release: jest.fn(),
        manager: {
          create: jest
            .fn()
            .mockImplementation((entity, payload) => ({ ...payload })),
          save: jest.fn().mockResolvedValue(savedPayments),
        },
      };

      (dataSource.createQueryRunner as jest.Mock).mockReturnValue(
        mockQueryRunner,
      );

      const result = await service.createBulk(createDtos as any);

      expect(mockQueryRunner.connect).toHaveBeenCalled();
      expect(mockQueryRunner.startTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.manager.create).toHaveBeenCalledTimes(2);
      expect(mockQueryRunner.manager.save).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            amount: 50.0,
            currency: 'USD',
            status: PaymentStatus.PENDING,
          }),
          expect.objectContaining({
            amount: 75.5,
            currency: 'USD',
            status: PaymentStatus.PENDING,
          }),
        ]),
      );
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();
      expect(result.created).toEqual(2);
      expect(result.payments).toEqual(savedPayments);
    });

    it('should rollback the transaction when bulk creation fails', async () => {
      const createDtos = [{ amount: 50.0, currency: 'USD' }];
      const error = new Error('Bulk save failed');

      const mockQueryRunner = {
        connect: jest.fn(),
        startTransaction: jest.fn(),
        commitTransaction: jest.fn(),
        rollbackTransaction: jest.fn(),
        release: jest.fn(),
        manager: {
          create: jest.fn().mockImplementation((entity, payload) => ({ ...payload })),
          save: jest.fn().mockRejectedValue(error),
        },
      };

      (dataSource.createQueryRunner as jest.Mock).mockReturnValue(
        mockQueryRunner,
      );

      await expect(service.createBulk(createDtos as any)).rejects.toThrow(
        error,
      );

      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.commitTransaction).not.toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();
    });
  });

  describe('findAll (offset-based, no cursor)', () => {
    it('should return a PaginatedResult with payments and total count', async () => {
      queryBuilderMock.getManyAndCount.mockResolvedValue([[mockPayment1, mockPayment2], 2]);

      const dto = new GetPaymentsDto();
      dto.page = 1;
      dto.limit = 20;

      const result = await service.findAll(dto);

      expect(result).toEqual({
        data: [mockPayment1, mockPayment2],
        total: 2,
        page: 1,
        limit: 20,
      });
      expect(queryBuilderMock.andWhere).not.toHaveBeenCalled();
      expect(queryBuilderMock.skip).toHaveBeenCalledWith(0);
      expect(queryBuilderMock.take).toHaveBeenCalledWith(20);
      expect(queryBuilderMock.orderBy).toHaveBeenCalledWith('payment.createdAt', 'DESC');
      expect(queryBuilderMock.addOrderBy).toHaveBeenCalledWith('payment.id', 'DESC');
    });

    it('should apply filters when provided', async () => {
      queryBuilderMock.getManyAndCount.mockResolvedValue([[mockPayment2], 1]);

      const dto = new GetPaymentsDto();
      dto.page = 1;
      dto.limit = 10;
      dto.status = PaymentStatus.COMPLETED;
      dto.currency = 'USD';

      const result = await service.findAll(dto);

      expect(result).toEqual({
        data: [mockPayment2],
        total: 1,
        page: 1,
        limit: 10,
      });
      expect(queryBuilderMock.andWhere).toHaveBeenCalledWith(
        'payment.status = :status', { status: PaymentStatus.COMPLETED },
      );
      expect(queryBuilderMock.andWhere).toHaveBeenCalledWith(
        'payment.currency = :currency', { currency: 'USD' },
      );
    });
  });

  describe('findAll (cursor-based)', () => {
    const encodeCursor = (sortBy: string, payment: any): string => {
      let sortValue: string;
      switch (sortBy) {
        case 'created_at':
          sortValue = payment.createdAt.toISOString();
          break;
        case 'amount':
          sortValue = String(payment.amount);
          break;
        case 'status':
          sortValue = payment.status;
          break;
        default:
          sortValue = '';
      }
      const raw = `${sortBy}:${sortValue}:${payment.id}`;
      return Buffer.from(raw, 'utf-8').toString('base64');
    };

    it('should return CursorPaginatedResult with nextCursor and hasMore', async () => {
      const payments = [mockPayment1, mockPayment2, mockPayment3];
      queryBuilderMock.getMany.mockResolvedValue(payments);

      const dto = new GetPaymentsDto();
      dto.cursor = encodeCursor('created_at', mockPayment1);
      dto.limit = 2;

      const result = await service.findAll(dto);

      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('nextCursor');
      expect(result).toHaveProperty('hasMore');
      expect((result as any).data.length).toBe(2);
      expect((result as any).hasMore).toBe(true);
      expect((result as any).nextCursor).toBeTruthy();
      expect(queryBuilderMock.take).toHaveBeenCalledWith(3);
    });

    it('should return hasMore=false on last page', async () => {
      queryBuilderMock.getMany.mockResolvedValue([mockPayment1, mockPayment2]);

      const dto = new GetPaymentsDto();
      dto.cursor = encodeCursor('created_at', mockPayment1);
      dto.limit = 5;

      const result = await service.findAll(dto);

      expect((result as any).hasMore).toBe(false);
      expect((result as any).nextCursor).toBeTruthy();
    });

    it('should return nextCursor=null for empty results', async () => {
      queryBuilderMock.getMany.mockResolvedValue([]);

      const dto = new GetPaymentsDto();
      dto.cursor = encodeCursor('created_at', mockPayment3);

      const result = await service.findAll(dto);

      expect((result as any).data).toEqual([]);
      expect((result as any).nextCursor).toBeNull();
      expect((result as any).hasMore).toBe(false);
    });

    it('should apply cursor condition for created_at DESC', async () => {
      queryBuilderMock.getMany.mockResolvedValue([mockPayment2, mockPayment3]);

      const dto = new GetPaymentsDto();
      dto.cursor = encodeCursor('created_at', mockPayment1);
      dto.sortBy = PaymentSortBy.CREATED_AT;
      dto.order = SortOrder.DESC;

      await service.findAll(dto);

      expect(queryBuilderMock.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('payment.createdAt < :cursorValue'),
        expect.objectContaining({
          cursorValue: mockPayment1.createdAt.toISOString(),
          cursorId: mockPayment1.id,
        }),
      );
    });

    it('should apply cursor condition for amount ASC', async () => {
      queryBuilderMock.getMany.mockResolvedValue([mockPayment2]);

      const dto = new GetPaymentsDto();
      dto.cursor = encodeCursor('amount', mockPayment1);
      dto.sortBy = PaymentSortBy.AMOUNT;
      dto.order = SortOrder.ASC;

      await service.findAll(dto);

      expect(queryBuilderMock.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('payment.amount > :cursorValue'),
        expect.objectContaining({
          cursorValue: mockPayment1.amount,
          cursorId: mockPayment1.id,
        }),
      );
    });

    it('should apply cursor condition for status', async () => {
      queryBuilderMock.getMany.mockResolvedValue([mockPayment3]);

      const dto = new GetPaymentsDto();
      dto.cursor = encodeCursor('status', mockPayment2);
      dto.sortBy = PaymentSortBy.STATUS;
      dto.order = SortOrder.DESC;

      await service.findAll(dto);

      expect(queryBuilderMock.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('payment.status < :cursorValue'),
        expect.objectContaining({
          cursorValue: mockPayment2.status,
          cursorId: mockPayment2.id,
        }),
      );
    });

    it('should throw BadRequestException on invalid cursor', async () => {
      const dto = new GetPaymentsDto();
      dto.cursor = 'not-valid-base64!!!';

      await expect(service.findAll(dto)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException on malformed cursor', async () => {
      const dto = new GetPaymentsDto();
      dto.cursor = Buffer.from('invalid-no-separators').toString('base64');

      await expect(service.findAll(dto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('findOne', () => {
    it('should return a single payment', async () => {
      const result = await service.findOne('uuid-001');
      expect(result).toEqual(mockPayment1);
      expect(repository.findOneBy).toHaveBeenCalledWith({ id: 'uuid-001' });
    });

    it('should throw NotFoundException if payment not found', async () => {
      jest.spyOn(repository, 'findOneBy').mockResolvedValueOnce(null);
      await expect(service.findOne('invalid-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('handleWebhook', () => {
    it('should update payment status using transaction', async () => {
      const webhookDto = {
        paymentId: 'uuid-001',
        status: PaymentStatus.COMPLETED,
        externalReference: 'EXT-999',
      };

      const updatedPayment = {
        ...mockPayment1,
        status: PaymentStatus.COMPLETED,
        externalReference: 'EXT-999',
      };

      const mockQueryRunner = {
        connect: jest.fn(),
        startTransaction: jest.fn(),
        commitTransaction: jest.fn(),
        rollbackTransaction: jest.fn(),
        release: jest.fn(),
        manager: {
          findOneBy: jest.fn().mockResolvedValue(mockPayment1),
          save: jest.fn().mockResolvedValue(updatedPayment),
        },
      };

      (dataSource.createQueryRunner as jest.Mock).mockReturnValue(
        mockQueryRunner,
      );

      const result = await service.handleWebhook(webhookDto);

      expect(mockQueryRunner.connect).toHaveBeenCalled();
      expect(mockQueryRunner.startTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.manager.findOneBy).toHaveBeenCalledWith(Payment, {
        id: 'uuid-001',
      });
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();
      expect(result.status).toEqual(PaymentStatus.COMPLETED);
      expect(result.externalReference).toEqual('EXT-999');
    });

    it('should throw NotFoundException if payment not found in webhook', async () => {
      const webhookDto = {
        paymentId: 'invalid-id',
        status: PaymentStatus.COMPLETED,
      };

      const mockQueryRunner = {
        connect: jest.fn(),
        startTransaction: jest.fn(),
        commitTransaction: jest.fn(),
        rollbackTransaction: jest.fn(),
        release: jest.fn(),
        manager: {
          findOneBy: jest.fn().mockResolvedValue(null),
          save: jest.fn(),
        },
      };

      (dataSource.createQueryRunner as jest.Mock).mockReturnValue(
        mockQueryRunner,
      );

      await expect(service.handleWebhook(webhookDto)).rejects.toThrow(
        NotFoundException,
      );

      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.commitTransaction).not.toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();
    });

    it('should rollback transaction on webhook update failure', async () => {
      const webhookDto = {
        paymentId: 'uuid-001',
        status: PaymentStatus.COMPLETED,
      };

      const error = new Error('Update failed');

      const mockQueryRunner = {
        connect: jest.fn(),
        startTransaction: jest.fn(),
        commitTransaction: jest.fn(),
        rollbackTransaction: jest.fn(),
        release: jest.fn(),
        manager: {
          findOneBy: jest.fn().mockResolvedValue(mockPayment1),
          save: jest.fn().mockRejectedValue(error),
        },
      };

      (dataSource.createQueryRunner as jest.Mock).mockReturnValue(
        mockQueryRunner,
      );

      await expect(service.handleWebhook(webhookDto)).rejects.toThrow(error);

      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.commitTransaction).not.toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();
    });
  });

  describe('getMerchantFeeConfig', () => {
    it('returns existing fee configuration for merchant', async () => {
      const existingConfig = {
        merchantId: 'merchant-1',
        flatFee: 1.5,
        percentageFee: 2.25,
        minFee: 0.5,
      };
      jest
        .spyOn(merchantFeeConfigRepository, 'findOneBy')
        .mockResolvedValueOnce(existingConfig as MerchantFeeConfig);

      await expect(service.getMerchantFeeConfig('merchant-1')).resolves.toEqual(
        {
          merchantId: 'merchant-1',
          flatFee: 1.5,
          percentageFee: 2.25,
          minFee: 0.5,
        },
      );
    });

    it('returns zeroed defaults when no fee config exists', async () => {
      jest
        .spyOn(merchantFeeConfigRepository, 'findOneBy')
        .mockResolvedValueOnce(null);

      await expect(service.getMerchantFeeConfig('merchant-2')).resolves.toEqual(
        {
          merchantId: 'merchant-2',
          flatFee: 0,
          percentageFee: 0,
          minFee: 0,
        },
      );
    });
  });
});
