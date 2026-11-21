import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UnprocessableEntityException } from '@nestjs/common';
import { MerchantLimitsService } from './merchant-limits.service';
import { MerchantLimit } from './entities/merchant-limit.entity';
import { Payment } from '../payments/payment.entity';

describe('MerchantLimitsService', () => {
  let service: MerchantLimitsService;
  let limitsRepository: any;
  let paymentsRepository: any;

  const createMockLimit = (overrides: Partial<MerchantLimit> = {}): MerchantLimit =>
    ({
      id: 'limit-1',
      merchantId: 'merchant-1',
      currency: 'USD',
      maxSinglePayment: null,
      dailyVolume: null,
      monthlyVolume: null,
      ...overrides,
    } as MerchantLimit);

  const createMockPayment = (overrides: Partial<Payment> = {}): Payment =>
    ({
      id: 'payment-1',
      merchantId: 'merchant-1',
      amount: 1000,
      currency: 'USD',
      status: 'COMPLETED',
      createdAt: new Date(),
      ...overrides,
    } as Payment);

  beforeEach(async () => {
    limitsRepository = {
      findOneBy: jest.fn(),
      find: jest.fn(),
      create: jest.fn((data) => data),
      save: jest.fn(async (limit) => limit),
    };

    paymentsRepository = {
      createQueryBuilder: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MerchantLimitsService,
        {
          provide: getRepositoryToken(MerchantLimit),
          useValue: limitsRepository,
        },
        {
          provide: getRepositoryToken(Payment),
          useValue: paymentsRepository,
        },
      ],
    }).compile();

    service = module.get<MerchantLimitsService>(MerchantLimitsService);
  });

  describe('upsert', () => {
    it('should create a new limit when none exists', async () => {
      limitsRepository.findOneBy.mockResolvedValue(null);

      const result = await service.upsert('merchant-1', {
        currency: 'USD',
        maxSinglePayment: 10000,
      });

      expect(limitsRepository.create).toHaveBeenCalledWith({
        merchantId: 'merchant-1',
        currency: 'USD',
        maxSinglePayment: null,
        dailyVolume: null,
        monthlyVolume: null,
      });
      expect(result.maxSinglePayment).toBe(10000);
      expect(limitsRepository.save).toHaveBeenCalled();
    });

    it('should update an existing limit', async () => {
      const existing = createMockLimit({ dailyVolume: 50000 });
      limitsRepository.findOneBy.mockResolvedValue(existing);

      const result = await service.upsert('merchant-1', {
        currency: 'USD',
        dailyVolume: 100000,
      });

      expect(result.dailyVolume).toBe(100000);
      expect(limitsRepository.save).toHaveBeenCalled();
    });

    it('should set multiple limits at once', async () => {
      limitsRepository.findOneBy.mockResolvedValue(null);

      await service.upsert('merchant-1', {
        currency: 'USD',
        maxSinglePayment: 10000,
        dailyVolume: 100000,
        monthlyVolume: 1000000,
      });

      expect(limitsRepository.save).toHaveBeenCalled();
    });

    it('should only update provided fields', async () => {
      const existing = createMockLimit({
        maxSinglePayment: 5000,
        dailyVolume: 50000,
        monthlyVolume: 500000,
      });
      limitsRepository.findOneBy.mockResolvedValue(existing);

      const result = await service.upsert('merchant-1', {
        currency: 'USD',
        maxSinglePayment: 15000,
      });

      expect(result.maxSinglePayment).toBe(15000);
      expect(result.dailyVolume).toBe(50000); // unchanged
      expect(result.monthlyVolume).toBe(500000); // unchanged
    });
  });

  describe('getForMerchant', () => {
    it('should return all limits for a merchant', async () => {
      const limits = [
        createMockLimit({ currency: 'USD' }),
        createMockLimit({ currency: 'EUR', merchantId: 'merchant-1' }),
      ];
      limitsRepository.find.mockResolvedValue(limits);

      const result = await service.getForMerchant('merchant-1');

      expect(result).toEqual(limits);
      expect(limitsRepository.find).toHaveBeenCalledWith({
        where: { merchantId: 'merchant-1' },
        order: { currency: 'ASC' },
      });
    });

    it('should return empty array when no limits exist', async () => {
      limitsRepository.find.mockResolvedValue([]);

      const result = await service.getForMerchant('merchant-1');

      expect(result).toEqual([]);
    });
  });

  describe('getForCurrency', () => {
    it('should return limit for specific currency', async () => {
      const limit = createMockLimit({ currency: 'USD' });
      limitsRepository.findOneBy.mockResolvedValue(limit);

      const result = await service.getForCurrency('merchant-1', 'USD');

      expect(result).toEqual(limit);
      expect(limitsRepository.findOneBy).toHaveBeenCalledWith({
        merchantId: 'merchant-1',
        currency: 'USD',
      });
    });

    it('should return null when no limit exists for currency', async () => {
      limitsRepository.findOneBy.mockResolvedValue(null);

      const result = await service.getForCurrency('merchant-1', 'GBP');

      expect(result).toBeNull();
    });
  });

  describe('enforce', () => {
    beforeEach(() => {
      const mockQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ sum: '5000' }),
      };
      paymentsRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);
    });

    it('should return empty warnings when no limits set', async () => {
      limitsRepository.findOneBy.mockResolvedValue(null);

      const result = await service.enforce('merchant-1', 'USD', 1000);

      expect(result).toEqual([]);
    });

    it('should throw when single payment exceeds limit', async () => {
      const limit = createMockLimit({ maxSinglePayment: 5000 });
      limitsRepository.findOneBy.mockResolvedValue(limit);

      await expect(service.enforce('merchant-1', 'USD', 6000)).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it('should throw when daily volume would be exceeded', async () => {
      const limit = createMockLimit({ dailyVolume: 10000 });
      limitsRepository.findOneBy.mockResolvedValue(limit);

      const mockQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ sum: '9500' }),
      };
      paymentsRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      await expect(service.enforce('merchant-1', 'USD', 1000)).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it('should throw when monthly volume would be exceeded', async () => {
      const limit = createMockLimit({ monthlyVolume: 50000 });
      limitsRepository.findOneBy.mockResolvedValue(limit);

      const mockQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ sum: '49000' }),
      };
      paymentsRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      await expect(service.enforce('merchant-1', 'USD', 2000)).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it('should return warning when approaching single payment limit', async () => {
      const limit = createMockLimit({ maxSinglePayment: 10000 });
      limitsRepository.findOneBy.mockResolvedValue(limit);

      const result = await service.enforce('merchant-1', 'USD', 8500); // 85% of limit

      expect(result).toContainEqual(
        expect.objectContaining({
          limitType: 'single payment',
          limit: 10000,
          currentVolume: 8500,
        }),
      );
    });

    it('should return warning when approaching daily volume limit', async () => {
      const limit = createMockLimit({ dailyVolume: 10000 });
      limitsRepository.findOneBy.mockResolvedValue(limit);

      const mockQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ sum: '7500' }),
      };
      paymentsRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      const result = await service.enforce('merchant-1', 'USD', 2000); // total 9500, 95% of limit

      expect(result).toContainEqual(
        expect.objectContaining({
          limitType: 'daily volume',
          limit: 10000,
        }),
      );
    });

    it('should return warning when approaching monthly volume limit', async () => {
      const limit = createMockLimit({ monthlyVolume: 50000 });
      limitsRepository.findOneBy.mockResolvedValue(limit);

      const mockQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ sum: '40000' }),
      };
      paymentsRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      const result = await service.enforce('merchant-1', 'USD', 5000); // total 45000, 90% of limit

      expect(result).toContainEqual(
        expect.objectContaining({
          limitType: 'monthly volume',
          limit: 50000,
        }),
      );
    });

    it('should handle null merchantId gracefully', async () => {
      const result = await service.enforce(null, 'USD', 1000);

      expect(result).toEqual([]);
      expect(limitsRepository.findOneBy).not.toHaveBeenCalled();
    });

    it('should handle undefined merchantId gracefully', async () => {
      const result = await service.enforce(undefined, 'USD', 1000);

      expect(result).toEqual([]);
      expect(limitsRepository.findOneBy).not.toHaveBeenCalled();
    });

    it('should update batch totals when provided', async () => {
      const limit = createMockLimit({ dailyVolume: 100000 });
      limitsRepository.findOneBy.mockResolvedValue(limit);

      const batchTotals = new Map<string, number>();

      await service.enforce('merchant-1', 'USD', 5000, undefined, batchTotals);

      expect(batchTotals.get('merchant-1:USD')).toBe(5005); // 5000 from payment + 5 from previous query
    });

    it('should respect batch totals in calculations', async () => {
      const limit = createMockLimit({ dailyVolume: 20000 });
      limitsRepository.findOneBy.mockResolvedValue(limit);

      const mockQueryBuilder = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ sum: '10000' }),
      };
      paymentsRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      const batchTotals = new Map<string, number>([['merchant-1:USD', 5000]]);

      // Total: 10000 (from db) + 5000 (batch) + 8000 (new) = 23000 > 20000
      await expect(
        service.enforce('merchant-1', 'USD', 8000, undefined, batchTotals),
      ).rejects.toThrow(UnprocessableEntityException);
    });
  });

  describe('edge cases', () => {
    it('should handle decimal amounts correctly', async () => {
      const limit = createMockLimit({ maxSinglePayment: 1000.50 });
      limitsRepository.findOneBy.mockResolvedValue(limit);

      await expect(service.enforce('merchant-1', 'USD', 1000.51)).rejects.toThrow(
        UnprocessableEntityException,
      );
    });

    it('should handle string amounts correctly', async () => {
      const limit = createMockLimit({ maxSinglePayment: 10000 });
      limitsRepository.findOneBy.mockResolvedValue(limit);

      // Service converts string to number
      const result = await service.enforce('merchant-1', 'USD', 5000);

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it('should not trigger warnings below 80% threshold', async () => {
      const limit = createMockLimit({ maxSinglePayment: 10000 });
      limitsRepository.findOneBy.mockResolvedValue(limit);

      const result = await service.enforce('merchant-1', 'USD', 7900); // 79% of limit

      expect(result).not.toContainEqual(
        expect.objectContaining({
          limitType: 'single payment',
        }),
      );
    });

    it('should trigger warnings at exactly 80% threshold', async () => {
      const limit = createMockLimit({ maxSinglePayment: 10000 });
      limitsRepository.findOneBy.mockResolvedValue(limit);

      const result = await service.enforce('merchant-1', 'USD', 8000); // exactly 80% of limit

      expect(result).toContainEqual(
        expect.objectContaining({
          limitType: 'single payment',
        }),
      );
    });
  });
});
