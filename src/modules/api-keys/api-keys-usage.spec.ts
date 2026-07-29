import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { ApiKeysService } from './api-keys.service';
import { ApiKey } from './api-key.entity';
import { ApiKeyUsage } from './api-key-usage.entity';

describe('ApiKeysService - Usage Tracking', () => {
  let service: ApiKeysService;
  let apiKeyRepository: Repository<ApiKey>;
  let apiKeyUsageRepository: Repository<ApiKeyUsage>;

  const mockApiKey: Partial<ApiKey> = {
    id: 'test-key-id',
    userId: 'test-user-id',
    name: 'Test Key',
    keyPrefix: 'fp_test_xxx',
    isActive: true,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApiKeysService,
        {
          provide: getRepositoryToken(ApiKey),
          useValue: {
            findOne: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(ApiKeyUsage),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
            createQueryBuilder: jest.fn(),
            delete: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: any) => {
              if (key === 'API_KEY_USAGE_RETENTION_DAYS') return 90;
              return defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<ApiKeysService>(ApiKeysService);
    apiKeyRepository = module.get(getRepositoryToken(ApiKey));
    apiKeyUsageRepository = module.get(getRepositoryToken(ApiKeyUsage));
  });

  describe('recordUsage', () => {
    it('should record API key usage with all parameters', async () => {
      const usageData = {
        apiKeyId: 'test-key-id',
        endpoint: '/v1/payments',
        method: 'POST',
        sourceIp: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
        statusCode: 201,
      };

      const mockUsage = { id: 'usage-1', ...usageData };

      jest.spyOn(apiKeyUsageRepository, 'create').mockReturnValue(mockUsage as any);
      jest.spyOn(apiKeyUsageRepository, 'save').mockResolvedValue(mockUsage as any);

      await service.recordUsage(
        usageData.apiKeyId,
        usageData.endpoint,
        usageData.method,
        usageData.sourceIp,
        usageData.userAgent,
        usageData.statusCode,
      );

      expect(apiKeyUsageRepository.create).toHaveBeenCalledWith({
        apiKeyId: usageData.apiKeyId,
        endpoint: usageData.endpoint,
        method: usageData.method,
        sourceIp: usageData.sourceIp,
        userAgent: usageData.userAgent,
        statusCode: usageData.statusCode,
      });
      expect(apiKeyUsageRepository.save).toHaveBeenCalledWith(mockUsage);
    });

    it('should record usage without optional statusCode', async () => {
      const usageData = {
        apiKeyId: 'test-key-id',
        endpoint: '/v1/payments',
        method: 'POST',
        sourceIp: '192.168.1.1',
        userAgent: 'Mozilla/5.0',
      };

      const mockUsage = { id: 'usage-1', ...usageData, statusCode: null };

      jest.spyOn(apiKeyUsageRepository, 'create').mockReturnValue(mockUsage as any);
      jest.spyOn(apiKeyUsageRepository, 'save').mockResolvedValue(mockUsage as any);

      await service.recordUsage(
        usageData.apiKeyId,
        usageData.endpoint,
        usageData.method,
        usageData.sourceIp,
        usageData.userAgent,
      );

      expect(apiKeyUsageRepository.create).toHaveBeenCalledWith({
        apiKeyId: usageData.apiKeyId,
        endpoint: usageData.endpoint,
        method: usageData.method,
        sourceIp: usageData.sourceIp,
        userAgent: usageData.userAgent,
        statusCode: null,
      });
    });
  });

  describe('getUsageHistory', () => {
    it('should return paginated usage history for valid API key', async () => {
      const mockUsageRecords = [
        {
          id: 'usage-1',
          apiKeyId: 'test-key-id',
          endpoint: '/v1/payments',
          method: 'POST',
          sourceIp: '192.168.1.1',
          createdAt: new Date(),
        },
        {
          id: 'usage-2',
          apiKeyId: 'test-key-id',
          endpoint: '/v1/payments/123',
          method: 'GET',
          sourceIp: '192.168.1.2',
          createdAt: new Date(),
        },
      ];

      jest.spyOn(apiKeyRepository, 'findOne').mockResolvedValue(mockApiKey as ApiKey);

      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([mockUsageRecords, 2]),
      };

      jest
        .spyOn(apiKeyUsageRepository, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as any);

      const result = await service.getUsageHistory('test-key-id', 'test-user-id', {
        page: 1,
        limit: 20,
      });

      expect(result).toEqual({
        data: mockUsageRecords,
        total: 2,
        page: 1,
        limit: 20,
      });
      expect(apiKeyRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'test-key-id', userId: 'test-user-id' },
      });
    });

    it('should throw NotFoundException if API key does not belong to user', async () => {
      jest.spyOn(apiKeyRepository, 'findOne').mockResolvedValue(null);

      await expect(
        service.getUsageHistory('invalid-key-id', 'test-user-id', { page: 1 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should filter usage by date range', async () => {
      jest.spyOn(apiKeyRepository, 'findOne').mockResolvedValue(mockApiKey as ApiKey);

      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      };

      jest
        .spyOn(apiKeyUsageRepository, 'createQueryBuilder')
        .mockReturnValue(mockQueryBuilder as any);

      await service.getUsageHistory('test-key-id', 'test-user-id', {
        page: 1,
        limit: 20,
        from: '2026-01-01T00:00:00Z',
        to: '2026-12-31T23:59:59Z',
      });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'usage.createdAt BETWEEN :from AND :to',
        {
          from: new Date('2026-01-01T00:00:00Z'),
          to: new Date('2026-12-31T23:59:59Z'),
        },
      );
    });
  });

  describe('pruneOldUsageRecords', () => {
    it('should delete records older than retention period', async () => {
      const mockDeleteResult = { affected: 150 };
      jest.spyOn(apiKeyUsageRepository, 'delete').mockResolvedValue(mockDeleteResult as any);
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await service.pruneOldUsageRecords();

      expect(apiKeyUsageRepository.delete).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Pruned 150 API key usage records'),
      );

      consoleSpy.mockRestore();
    });
  });
});
