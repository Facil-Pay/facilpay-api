import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { PaymentsService } from './payments.service';
import { Payment, PaymentStatus } from './payment.entity';
import { NotFoundException } from '@nestjs/common';
import { AppLogger } from '../logger/logger.service';

describe('PaymentsService', () => {
  let service: PaymentsService;
  let repository: Repository<Payment>;
  let dataSource: DataSource;

  const mockPayment = {
    id: 'uuid-123',
    amount: 100.5,
    currency: 'USD',
    status: PaymentStatus.PENDING,
    description: 'Test payment',
    externalReference: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockPaymentRepository = {
    create: jest.fn().mockImplementation((dto) => dto),
    save: jest.fn().mockImplementation((payment) =>
      Promise.resolve({
        id: 'uuid-123',
        ...payment,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ),
    find: jest.fn().mockResolvedValue([mockPayment]),
    findOneBy: jest.fn().mockResolvedValue(mockPayment),
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

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        {
          provide: getRepositoryToken(Payment),
          useValue: mockPaymentRepository,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: AppLogger,
          useValue: mockAppLogger,
        },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
    repository = module.get<Repository<Payment>>(getRepositoryToken(Payment));
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
            .mockReturnValue({ ...mockPayment, status: PaymentStatus.PENDING }),
          save: jest.fn().mockResolvedValue({ ...mockPayment }),
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
            .mockReturnValue({ ...mockPayment, status: PaymentStatus.PENDING }),
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

  describe('findAll', () => {
    it('should return an array of payments', async () => {
      const result = await service.findAll();
      expect(result).toEqual([mockPayment]);
      expect(repository.find).toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('should return a single payment', async () => {
      const result = await service.findOne('uuid-123');
      expect(result).toEqual(mockPayment);
      expect(repository.findOneBy).toHaveBeenCalledWith({ id: 'uuid-123' });
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
        paymentId: 'uuid-123',
        status: PaymentStatus.COMPLETED,
        externalReference: 'EXT-999',
      };

      const updatedPayment = {
        ...mockPayment,
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
          findOneBy: jest.fn().mockResolvedValue(mockPayment),
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
        id: 'uuid-123',
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
        paymentId: 'uuid-123',
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
          findOneBy: jest.fn().mockResolvedValue(mockPayment),
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
});
