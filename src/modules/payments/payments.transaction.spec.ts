import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository, QueryRunner } from 'typeorm';
import { NotFoundException } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { Payment, PaymentStatus } from './payment.entity';
import { AppLogger } from '../logger/logger.service';

describe('PaymentsService - Transactions', () => {
  let service: PaymentsService;
  let repository: Repository<Payment>;
  let dataSource: DataSource;
  let queryRunner: QueryRunner;

  const mockPayment: Payment = {
    id: '123',
    amount: 100.0,
    currency: 'USD',
    status: PaymentStatus.PENDING,
    externalReference: null,
    description: 'Test payment',
    createdAt: new Date(),
    updatedAt: new Date(),
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
    queryRunner = {
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
    } as unknown as QueryRunner;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        {
          provide: getRepositoryToken(Payment),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            find: jest.fn(),
            findOneBy: jest.fn(),
          },
        },
        {
          provide: DataSource,
          useValue: {
            createQueryRunner: jest.fn(() => queryRunner),
          },
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

  describe('create - Transaction Management', () => {
    it('should create payment within a transaction', async () => {
      const createDto = {
        amount: 100.0,
        currency: 'USD',
        description: 'Test payment',
      };

      (queryRunner.manager.create as jest.Mock).mockReturnValue(mockPayment);
      (queryRunner.manager.save as jest.Mock).mockResolvedValue(mockPayment);

      const result = await service.create(createDto);

      expect(dataSource.createQueryRunner).toHaveBeenCalled();
      expect(queryRunner.connect).toHaveBeenCalled();
      expect(queryRunner.startTransaction).toHaveBeenCalled();
      expect(queryRunner.manager.create).toHaveBeenCalledWith(Payment, {
        ...createDto,
        status: PaymentStatus.PENDING,
      });
      expect(queryRunner.commitTransaction).toHaveBeenCalled();
      expect(queryRunner.release).toHaveBeenCalled();
      expect(result).toEqual(mockPayment);
    });

    it('should rollback transaction on creation failure', async () => {
      const createDto = {
        amount: 100.0,
        currency: 'USD',
        description: 'Test payment',
      };

      const error = new Error('Database error');
      (queryRunner.manager.create as jest.Mock).mockReturnValue(mockPayment);
      (queryRunner.manager.save as jest.Mock).mockRejectedValue(error);

      await expect(service.create(createDto)).rejects.toThrow(error);

      expect(queryRunner.startTransaction).toHaveBeenCalled();
      expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
      expect(queryRunner.release).toHaveBeenCalled();
    });

    it('should release queryRunner even on error', async () => {
      const createDto = {
        amount: 100.0,
        currency: 'USD',
        description: 'Test payment',
      };

      (queryRunner.connect as jest.Mock).mockRejectedValue(
        new Error('Connection failed'),
      );

      try {
        await service.create(createDto);
      } catch {
        // Expected
      }

      expect(queryRunner.release).toHaveBeenCalled();
    });
  });

  describe('handleWebhook - Transaction Management', () => {
    it('should update payment within a transaction', async () => {
      const webhookDto = {
        paymentId: '123',
        status: PaymentStatus.COMPLETED,
        externalReference: 'ext_ref_123',
      };

      const updatedPayment = {
        ...mockPayment,
        status: PaymentStatus.COMPLETED,
        externalReference: 'ext_ref_123',
      };

      (queryRunner.manager.findOneBy as jest.Mock).mockResolvedValue(
        mockPayment,
      );
      (queryRunner.manager.save as jest.Mock).mockResolvedValue(updatedPayment);

      const result = await service.handleWebhook(webhookDto);

      expect(dataSource.createQueryRunner).toHaveBeenCalled();
      expect(queryRunner.connect).toHaveBeenCalled();
      expect(queryRunner.startTransaction).toHaveBeenCalled();
      expect(queryRunner.manager.findOneBy).toHaveBeenCalledWith(Payment, {
        id: '123',
      });
      expect(queryRunner.commitTransaction).toHaveBeenCalled();
      expect(queryRunner.release).toHaveBeenCalled();
      expect(result).toEqual(updatedPayment);
    });

    it('should rollback transaction on webhook update failure', async () => {
      const webhookDto = {
        paymentId: '123',
        status: PaymentStatus.COMPLETED,
      };

      const error = new Error('Update failed');
      (queryRunner.manager.findOneBy as jest.Mock).mockResolvedValue(
        mockPayment,
      );
      (queryRunner.manager.save as jest.Mock).mockRejectedValue(error);

      await expect(service.handleWebhook(webhookDto)).rejects.toThrow(error);

      expect(queryRunner.startTransaction).toHaveBeenCalled();
      expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
      expect(queryRunner.release).toHaveBeenCalled();
    });

    it('should throw NotFoundException when payment not found in webhook', async () => {
      const webhookDto = {
        paymentId: 'nonexistent',
        status: PaymentStatus.COMPLETED,
      };

      (queryRunner.manager.findOneBy as jest.Mock).mockResolvedValue(null);

      await expect(service.handleWebhook(webhookDto)).rejects.toThrow(
        NotFoundException,
      );

      expect(queryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(queryRunner.release).toHaveBeenCalled();
    });

    it('should update external reference in webhook', async () => {
      const webhookDto = {
        paymentId: '123',
        status: PaymentStatus.COMPLETED,
        externalReference: 'ext_ref_456',
      };

      const paymentWithoutRef = { ...mockPayment, externalReference: null };
      const updatedPayment = {
        ...paymentWithoutRef,
        status: PaymentStatus.COMPLETED,
        externalReference: 'ext_ref_456',
      };

      (queryRunner.manager.findOneBy as jest.Mock).mockResolvedValue(
        paymentWithoutRef,
      );
      (queryRunner.manager.save as jest.Mock).mockImplementation((entity) =>
        Promise.resolve(entity),
      );

      const result = await service.handleWebhook(webhookDto);

      expect(result.externalReference).toBe('ext_ref_456');
      expect(queryRunner.manager.save).toHaveBeenCalledWith(
        expect.objectContaining({
          externalReference: 'ext_ref_456',
        }),
      );
    });
  });

  describe('Non-transactional methods', () => {
    it('should find all payments without transaction', async () => {
      const payments = [mockPayment];
      (repository.find as jest.Mock).mockResolvedValue(payments);

      const result = await service.findAll();

      expect(repository.find).toHaveBeenCalledWith({
        order: { createdAt: 'DESC' },
      });
      expect(result).toEqual(payments);
      expect(dataSource.createQueryRunner).not.toHaveBeenCalled();
    });

    it('should find one payment without transaction', async () => {
      (repository.findOneBy as jest.Mock).mockResolvedValue(mockPayment);

      const result = await service.findOne('123');

      expect(repository.findOneBy).toHaveBeenCalledWith({ id: '123' });
      expect(result).toEqual(mockPayment);
      expect(dataSource.createQueryRunner).not.toHaveBeenCalled();
    });

    it('should throw error when payment not found', async () => {
      (repository.findOneBy as jest.Mock).mockResolvedValue(null);

      await expect(service.findOne('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
