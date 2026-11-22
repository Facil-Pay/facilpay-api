import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { RatesRedisService } from './rates-redis.service';

jest.mock('ioredis');

describe('RatesRedisService', () => {
  let service: RatesRedisService;
  let configService: jest.Mocked<ConfigService>;
  let redisClientMock: jest.Mocked<Redis>;

  beforeEach(async () => {
    // Clear Redis mock
    jest.clearAllMocks();

    configService = {
      get: jest.fn((key: string, defaultValue?: any) => {
        if (key === 'REDIS_HOST') return 'localhost';
        if (key === 'REDIS_PORT') return 6379;
        return defaultValue;
      }),
    } as any;

    redisClientMock = {
      get: jest.fn(),
      set: jest.fn(),
      disconnect: jest.fn(),
    } as any;

    (Redis as jest.MockedClass<typeof Redis>).mockImplementation(
      () => redisClientMock,
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RatesRedisService,
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<RatesRedisService>(RatesRedisService);
  });

  describe('constructor', () => {
    it('should create a Redis client with default configuration', () => {
      expect(Redis).toHaveBeenCalledWith({
        host: 'localhost',
        port: 6379,
        maxRetriesPerRequest: 1,
      });
    });

    it('should use configured REDIS_HOST', async () => {
      jest.clearAllMocks();
      configService.get = jest.fn((key: string, defaultValue?: any) => {
        if (key === 'REDIS_HOST') return 'redis.example.com';
        if (key === 'REDIS_PORT') return 6379;
        return defaultValue;
      });

      (Redis as jest.MockedClass<typeof Redis>).mockImplementation(
        () => redisClientMock,
      );

      await Test.createTestingModule({
        providers: [
          RatesRedisService,
          { provide: ConfigService, useValue: configService },
        ],
      }).compile();

      expect(Redis).toHaveBeenCalledWith({
        host: 'redis.example.com',
        port: 6379,
        maxRetriesPerRequest: 1,
      });
    });

    it('should use configured REDIS_PORT', async () => {
      jest.clearAllMocks();
      configService.get = jest.fn((key: string, defaultValue?: any) => {
        if (key === 'REDIS_HOST') return 'localhost';
        if (key === 'REDIS_PORT') return 6380;
        return defaultValue;
      });

      (Redis as jest.MockedClass<typeof Redis>).mockImplementation(
        () => redisClientMock,
      );

      await Test.createTestingModule({
        providers: [
          RatesRedisService,
          { provide: ConfigService, useValue: configService },
        ],
      }).compile();

      expect(Redis).toHaveBeenCalledWith({
        host: 'localhost',
        port: 6380,
        maxRetriesPerRequest: 1,
      });
    });
  });

  describe('get', () => {
    it('should retrieve a value from Redis by key', async () => {
      const testKey = 'rate:USD:EUR';
      const testValue = '0.92';

      redisClientMock.get.mockResolvedValue(testValue);

      const result = await service.get(testKey);

      expect(result).toBe(testValue);
      expect(redisClientMock.get).toHaveBeenCalledWith(testKey);
      expect(redisClientMock.get).toHaveBeenCalledTimes(1);
    });

    it('should return null when key does not exist', async () => {
      const testKey = 'rate:GBP:JPY';

      redisClientMock.get.mockResolvedValue(null);

      const result = await service.get(testKey);

      expect(result).toBeNull();
      expect(redisClientMock.get).toHaveBeenCalledWith(testKey);
    });

    it('should handle Redis connection errors', async () => {
      const testKey = 'rate:EUR:GBP';
      const error = new Error('Redis connection failed');

      redisClientMock.get.mockRejectedValue(error);

      await expect(service.get(testKey)).rejects.toThrow('Redis connection failed');
      expect(redisClientMock.get).toHaveBeenCalledWith(testKey);
    });

    it('should handle empty string values', async () => {
      const testKey = 'rate:USD:GBP';
      const testValue = '';

      redisClientMock.get.mockResolvedValue(testValue);

      const result = await service.get(testKey);

      expect(result).toBe('');
      expect(redisClientMock.get).toHaveBeenCalledWith(testKey);
    });

    it('should retrieve JSON-serialized data', async () => {
      const testKey = 'rates:batch';
      const testValue = JSON.stringify({
        'USD:EUR': 0.92,
        'USD:GBP': 0.79,
        'USD:JPY': 149.50,
      });

      redisClientMock.get.mockResolvedValue(testValue);

      const result = await service.get(testKey);

      expect(result).toBe(testValue);
      expect(JSON.parse(result)).toEqual({
        'USD:EUR': 0.92,
        'USD:GBP': 0.79,
        'USD:JPY': 149.50,
      });
    });

    it('should handle keys with special characters', async () => {
      const testKey = 'rate:USD/EUR:2026-01-15';
      const testValue = '0.915';

      redisClientMock.get.mockResolvedValue(testValue);

      const result = await service.get(testKey);

      expect(result).toBe(testValue);
      expect(redisClientMock.get).toHaveBeenCalledWith(testKey);
    });
  });

  describe('set', () => {
    it('should set a value in Redis with TTL', async () => {
      const testKey = 'rate:USD:EUR';
      const testValue = '0.92';
      const ttlSeconds = 3600;

      redisClientMock.set.mockResolvedValue('OK');

      await service.set(testKey, testValue, ttlSeconds);

      expect(redisClientMock.set).toHaveBeenCalledWith(
        testKey,
        testValue,
        'EX',
        ttlSeconds,
      );
      expect(redisClientMock.set).toHaveBeenCalledTimes(1);
    });

    it('should return undefined on successful set', async () => {
      const testKey = 'rate:GBP:JPY';
      const testValue = '189.23';
      const ttlSeconds = 1800;

      redisClientMock.set.mockResolvedValue('OK');

      const result = await service.set(testKey, testValue, ttlSeconds);

      expect(result).toBeUndefined();
    });

    it('should handle zero TTL', async () => {
      const testKey = 'rate:EUR:USD';
      const testValue = '1.09';
      const ttlSeconds = 0;

      redisClientMock.set.mockResolvedValue('OK');

      await service.set(testKey, testValue, ttlSeconds);

      expect(redisClientMock.set).toHaveBeenCalledWith(
        testKey,
        testValue,
        'EX',
        0,
      );
    });

    it('should handle large TTL values', async () => {
      const testKey = 'rate:CAD:AUD';
      const testValue = '0.88';
      const ttlSeconds = 31536000; // 1 year

      redisClientMock.set.mockResolvedValue('OK');

      await service.set(testKey, testValue, ttlSeconds);

      expect(redisClientMock.set).toHaveBeenCalledWith(
        testKey,
        testValue,
        'EX',
        31536000,
      );
    });

    it('should handle Redis connection errors during set', async () => {
      const testKey = 'rate:USD:CHF';
      const testValue = '0.88';
      const ttlSeconds = 3600;
      const error = new Error('Redis write failed');

      redisClientMock.set.mockRejectedValue(error);

      await expect(
        service.set(testKey, testValue, ttlSeconds),
      ).rejects.toThrow('Redis write failed');
      expect(redisClientMock.set).toHaveBeenCalledWith(
        testKey,
        testValue,
        'EX',
        ttlSeconds,
      );
    });

    it('should set JSON-serialized values', async () => {
      const testKey = 'rates:batch';
      const testValue = JSON.stringify({
        'USD:EUR': 0.92,
        'USD:GBP': 0.79,
      });
      const ttlSeconds = 3600;

      redisClientMock.set.mockResolvedValue('OK');

      await service.set(testKey, testValue, ttlSeconds);

      expect(redisClientMock.set).toHaveBeenCalledWith(
        testKey,
        testValue,
        'EX',
        ttlSeconds,
      );
    });

    it('should handle very long values', async () => {
      const testKey = 'rates:historical';
      const testValue = JSON.stringify(
        Array.from({ length: 1000 }, (_, i) => ({
          index: i,
          value: Math.random(),
        })),
      );
      const ttlSeconds = 86400;

      redisClientMock.set.mockResolvedValue('OK');

      await service.set(testKey, testValue, ttlSeconds);

      expect(redisClientMock.set).toHaveBeenCalledWith(
        testKey,
        testValue,
        'EX',
        ttlSeconds,
      );
    });

    it('should handle special characters in values', async () => {
      const testKey = 'rate:special';
      const testValue = 'Value with "quotes", \\backslash, and \n newlines';
      const ttlSeconds = 3600;

      redisClientMock.set.mockResolvedValue('OK');

      await service.set(testKey, testValue, ttlSeconds);

      expect(redisClientMock.set).toHaveBeenCalledWith(
        testKey,
        testValue,
        'EX',
        ttlSeconds,
      );
    });
  });

  describe('onModuleDestroy', () => {
    it('should disconnect Redis client on module destroy', () => {
      service.onModuleDestroy();

      expect(redisClientMock.disconnect).toHaveBeenCalledTimes(1);
      expect(redisClientMock.disconnect).toHaveBeenCalledWith();
    });

    it('should handle disconnect errors gracefully', () => {
      const error = new Error('Disconnect failed');
      redisClientMock.disconnect.mockImplementation(() => {
        throw error;
      });

      expect(() => service.onModuleDestroy()).toThrow('Disconnect failed');
      expect(redisClientMock.disconnect).toHaveBeenCalled();
    });
  });

  describe('integration scenarios', () => {
    it('should set and retrieve a rate value', async () => {
      const testKey = 'rate:USD:EUR';
      const testValue = '0.9215';

      redisClientMock.set.mockResolvedValue('OK');
      redisClientMock.get.mockResolvedValue(testValue);

      // Set
      await service.set(testKey, testValue, 3600);
      expect(redisClientMock.set).toHaveBeenCalledWith(
        testKey,
        testValue,
        'EX',
        3600,
      );

      // Get
      const result = await service.get(testKey);
      expect(result).toBe(testValue);
      expect(redisClientMock.get).toHaveBeenCalledWith(testKey);
    });

    it('should handle multiple sequential operations', async () => {
      redisClientMock.set.mockResolvedValue('OK');
      redisClientMock.get.mockResolvedValue(null);

      // First set
      await service.set('rate:1', 'value1', 3600);

      // Second set
      await service.set('rate:2', 'value2', 7200);

      // Get non-existent key
      const result = await service.get('rate:nonexistent');

      expect(redisClientMock.set).toHaveBeenCalledTimes(2);
      expect(redisClientMock.get).toHaveBeenCalledTimes(1);
      expect(result).toBeNull();
    });

    it('should cache currency conversion rates', async () => {
      const rates = {
        'USD:EUR': '0.9215',
        'USD:GBP': '0.7925',
        'USD:JPY': '149.50',
      };

      redisClientMock.set.mockResolvedValue('OK');

      for (const [key, value] of Object.entries(rates)) {
        await service.set(`rate:${key}`, value, 3600);
      }

      expect(redisClientMock.set).toHaveBeenCalledTimes(3);
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle null/undefined key gracefully', async () => {
      redisClientMock.get.mockResolvedValue(null);

      const result = await service.get('');

      expect(result).toBeNull();
      expect(redisClientMock.get).toHaveBeenCalledWith('');
    });

    it('should handle timeout errors from Redis', async () => {
      const error = new Error('Command timeout');
      redisClientMock.get.mockRejectedValue(error);

      await expect(service.get('rate:USD:EUR')).rejects.toThrow(
        'Command timeout',
      );
    });

    it('should handle network connectivity issues', async () => {
      const error = new Error('ECONNREFUSED');
      redisClientMock.set.mockRejectedValue(error);

      await expect(
        service.set('rate:test', 'value', 3600),
      ).rejects.toThrow('ECONNREFUSED');
    });

    it('should maintain proper state across multiple operations', async () => {
      redisClientMock.set.mockResolvedValue('OK');
      redisClientMock.get.mockResolvedValue('0.92');

      await service.set('rate:USD:EUR', '0.92', 3600);
      const result1 = await service.get('rate:USD:EUR');

      redisClientMock.get.mockResolvedValue('0.93');
      const result2 = await service.get('rate:USD:EUR');

      expect(result1).toBe('0.92');
      expect(result2).toBe('0.93');
      expect(redisClientMock.get).toHaveBeenCalledTimes(2);
    });
  });
});
