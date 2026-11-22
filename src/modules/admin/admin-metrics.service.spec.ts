import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { AdminMetricsService } from './admin-metrics.service';
import { GetMetricsDto } from './dto/get-metrics.dto';

describe('AdminMetricsService', () => {
  let service: AdminMetricsService;
  let dataSource: any;
  let configService: any;
  let redisClient: any;

  beforeEach(async () => {
    redisClient = {
      get: jest.fn(),
      set: jest.fn(),
      disconnect: jest.fn(),
    };

    dataSource = {
      query: jest.fn(),
    };

    configService = {
      get: jest.fn((key, defaultValue) => {
        const config: Record<string, any> = {
          REDIS_HOST: 'localhost',
          REDIS_PORT: 6379,
        };
        return config[key] ?? defaultValue;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminMetricsService,
        {
          provide: getDataSourceToken(),
          useValue: dataSource,
        },
        {
          provide: ConfigService,
          useValue: configService,
        },
      ],
    }).compile();

    service = module.get<AdminMetricsService>(AdminMetricsService);
    // Mock the Redis client after initialization
    (service as any).redisClient = redisClient;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getMetrics', () => {
    const mockMetricsData = {
      volumeByCurrency: [
        { currency: 'USD', volume: 50000 },
        { currency: 'EUR', volume: 30000 },
      ],
      paymentCountByStatus: [
        { status: 'COMPLETED', count: 150 },
        { status: 'PENDING', count: 20 },
        { status: 'FAILED', count: 5 },
      ],
      activeMerchants: 45,
      newSignups: 12,
      refundTotal: 5000,
      disputeTotal: 2500,
      feesCollected: 2500,
    };

    it('should return cached data if available', async () => {
      const query: GetMetricsDto = {
        from: '2026-01-01T00:00:00Z',
        to: '2026-01-31T23:59:59Z',
        interval: 'day',
      };

      redisClient.get.mockResolvedValue(JSON.stringify(mockMetricsData));

      const result = await service.getMetrics(query);

      expect(redisClient.get).toHaveBeenCalled();
      expect(result).toEqual(mockMetricsData);
      expect(dataSource.query).not.toHaveBeenCalled();
    });

    it('should query database if cache miss', async () => {
      const query: GetMetricsDto = {
        from: '2026-01-01T00:00:00Z',
        to: '2026-01-31T23:59:59Z',
        interval: 'day',
      };

      redisClient.get.mockResolvedValue(null);
      dataSource.query.mockResolvedValueOnce([
        { currency: 'USD', volume: 50000 },
      ]); // volume
      dataSource.query.mockResolvedValueOnce([
        { status: 'COMPLETED', count: 150 },
      ]); // status
      dataSource.query.mockResolvedValueOnce([{ active_merchants: 45 }]); // merchants
      dataSource.query.mockResolvedValueOnce([{ new_signups: 12 }]); // signups
      dataSource.query.mockResolvedValueOnce([{ refund_total: 5000 }]); // refunds
      dataSource.query.mockResolvedValueOnce([{ dispute_total: 2500 }]); // disputes
      dataSource.query.mockResolvedValueOnce([{ fees_collected: 2500 }]); // fees

      const result = await service.getMetrics(query);

      expect(dataSource.query).toHaveBeenCalledTimes(7);
      expect(result).toHaveProperty('volumeByCurrency');
      expect(result).toHaveProperty('paymentCountByStatus');
      expect(result).toHaveProperty('activeMerchants');
    });

    it('should cache results after database query', async () => {
      const query: GetMetricsDto = {
        from: '2026-01-01T00:00:00Z',
        to: '2026-01-31T23:59:59Z',
      };

      redisClient.get.mockResolvedValue(null);
      dataSource.query.mockResolvedValue([]);

      await service.getMetrics(query);

      expect(redisClient.set).toHaveBeenCalledWith(
        expect.stringContaining('admin_metrics'),
        expect.any(String),
        'EX',
        300,
      );
    });

    it('should use default date range if not provided', async () => {
      const query: GetMetricsDto = {};

      redisClient.get.mockResolvedValue(null);
      dataSource.query.mockResolvedValue([]);

      await service.getMetrics(query);

      // Verify queries were made with dates
      expect(dataSource.query).toHaveBeenCalled();
      const firstCall = dataSource.query.mock.calls[0];
      expect(firstCall[1]).toBeDefined();
      expect(firstCall[1].length).toBe(2); // Should have from and to dates
    });

    it('should use provided date range', async () => {
      const from = '2026-01-15T00:00:00Z';
      const to = '2026-01-20T23:59:59Z';
      const query: GetMetricsDto = { from, to };

      redisClient.get.mockResolvedValue(null);
      dataSource.query.mockResolvedValue([]);

      await service.getMetrics(query);

      const firstCall = dataSource.query.mock.calls[0];
      expect(firstCall[1]).toContain(from);
      expect(firstCall[1]).toContain(to);
    });

    it('should use default interval if not provided', async () => {
      const query: GetMetricsDto = {};

      redisClient.get.mockResolvedValue(null);
      dataSource.query.mockResolvedValue([]);

      await service.getMetrics(query);

      expect(dataSource.query).toHaveBeenCalled();
    });

    it('should return zero values when no data available', async () => {
      const query: GetMetricsDto = {
        from: '2026-01-01T00:00:00Z',
        to: '2026-01-31T23:59:59Z',
      };

      redisClient.get.mockResolvedValue(null);
      dataSource.query.mockResolvedValue([]);

      const result = await service.getMetrics(query);

      expect(result.activeMerchants).toBe(0);
      expect(result.newSignups).toBe(0);
      expect(result.refundTotal).toBe(0);
      expect(result.disputeTotal).toBe(0);
      expect(result.feesCollected).toBe(0);
    });

    it('should handle multiple currencies correctly', async () => {
      const query: GetMetricsDto = {
        from: '2026-01-01T00:00:00Z',
        to: '2026-01-31T23:59:59Z',
      };

      redisClient.get.mockResolvedValue(null);
      dataSource.query.mockResolvedValueOnce([
        { currency: 'USD', volume: 50000 },
        { currency: 'EUR', volume: 30000 },
        { currency: 'GBP', volume: 20000 },
      ]);
      dataSource.query.mockResolvedValueOnce([]);
      dataSource.query.mockResolvedValueOnce([]);
      dataSource.query.mockResolvedValueOnce([]);
      dataSource.query.mockResolvedValueOnce([]);
      dataSource.query.mockResolvedValueOnce([]);
      dataSource.query.mockResolvedValueOnce([]);

      const result = await service.getMetrics(query);

      expect(result.volumeByCurrency).toHaveLength(3);
      expect(result.volumeByCurrency[0].currency).toBe('USD');
      expect(result.volumeByCurrency[0].volume).toBe(50000);
    });

    it('should convert string values to numbers', async () => {
      const query: GetMetricsDto = {
        from: '2026-01-01T00:00:00Z',
        to: '2026-01-31T23:59:59Z',
      };

      redisClient.get.mockResolvedValue(null);
      dataSource.query.mockResolvedValueOnce([
        { currency: 'USD', volume: '50000' },
      ]);
      dataSource.query.mockResolvedValueOnce([
        { status: 'COMPLETED', count: '100' },
      ]);
      dataSource.query.mockResolvedValueOnce([{ active_merchants: '45' }]);
      dataSource.query.mockResolvedValueOnce([{ new_signups: '12' }]);
      dataSource.query.mockResolvedValueOnce([{ refund_total: '5000' }]);
      dataSource.query.mockResolvedValueOnce([{ dispute_total: '2500' }]);
      dataSource.query.mockResolvedValueOnce([{ fees_collected: '2500' }]);

      const result = await service.getMetrics(query);

      expect(typeof result.volumeByCurrency[0].volume).toBe('number');
      expect(typeof result.activeMerchants).toBe('number');
      expect(typeof result.refundTotal).toBe('number');
    });

    it('should handle null values in results', async () => {
      const query: GetMetricsDto = {
        from: '2026-01-01T00:00:00Z',
        to: '2026-01-31T23:59:59Z',
      };

      redisClient.get.mockResolvedValue(null);
      dataSource.query.mockResolvedValueOnce([]);
      dataSource.query.mockResolvedValueOnce([]);
      dataSource.query.mockResolvedValueOnce([]);
      dataSource.query.mockResolvedValueOnce([]);
      dataSource.query.mockResolvedValueOnce([{ refund_total: null }]);
      dataSource.query.mockResolvedValueOnce([{ dispute_total: null }]);
      dataSource.query.mockResolvedValueOnce([{ fees_collected: null }]);

      const result = await service.getMetrics(query);

      expect(result.refundTotal).toBe(0);
      expect(result.disputeTotal).toBe(0);
      expect(result.feesCollected).toBe(0);
    });

    it('should execute all required database queries', async () => {
      const query: GetMetricsDto = {
        from: '2026-01-01T00:00:00Z',
        to: '2026-01-31T23:59:59Z',
      };

      redisClient.get.mockResolvedValue(null);
      dataSource.query.mockResolvedValue([]);

      await service.getMetrics(query);

      // Should execute 7 queries: volume, status, merchants, signups, refunds, disputes, fees
      expect(dataSource.query).toHaveBeenCalledTimes(7);
    });

    it('should pass correct parameters to database queries', async () => {
      const from = '2026-01-01T00:00:00Z';
      const to = '2026-01-31T23:59:59Z';
      const query: GetMetricsDto = { from, to };

      redisClient.get.mockResolvedValue(null);
      dataSource.query.mockResolvedValue([]);

      await service.getMetrics(query);

      // First query should be for volume with from/to dates
      const volumeQuery = dataSource.query.mock.calls[0];
      expect(volumeQuery[1]).toEqual([from, to]);

      // Status query should also have dates
      const statusQuery = dataSource.query.mock.calls[1];
      expect(statusQuery[1]).toEqual([from, to]);
    });
  });

  describe('cache key generation', () => {
    it('should generate cache key with all parameters', async () => {
      const query: GetMetricsDto = {
        from: '2026-01-01T00:00:00Z',
        to: '2026-01-31T23:59:59Z',
        interval: 'week',
      };

      redisClient.get.mockResolvedValue(null);
      dataSource.query.mockResolvedValue([]);

      await service.getMetrics(query);

      const cacheKeyCall = redisClient.set.mock.calls[0][0];
      expect(cacheKeyCall).toContain('admin_metrics');
      expect(cacheKeyCall).toContain(query.from);
      expect(cacheKeyCall).toContain(query.to);
      expect(cacheKeyCall).toContain(query.interval);
    });

    it('should set cache expiration to 300 seconds', async () => {
      const query: GetMetricsDto = {
        from: '2026-01-01T00:00:00Z',
        to: '2026-01-31T23:59:59Z',
      };

      redisClient.get.mockResolvedValue(null);
      dataSource.query.mockResolvedValue([]);

      await service.getMetrics(query);

      const setCall = redisClient.set.mock.calls[0];
      expect(setCall[2]).toBe('EX');
      expect(setCall[3]).toBe(300);
    });
  });

  describe('onModuleDestroy', () => {
    it('should disconnect Redis on module destroy', () => {
      service.onModuleDestroy();

      expect(redisClient.disconnect).toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should handle very large metric values', async () => {
      const query: GetMetricsDto = {
        from: '2026-01-01T00:00:00Z',
        to: '2026-01-31T23:59:59Z',
      };

      redisClient.get.mockResolvedValue(null);
      dataSource.query.mockResolvedValueOnce([
        { currency: 'USD', volume: '999999999.99' },
      ]);
      dataSource.query.mockResolvedValueOnce([]);
      dataSource.query.mockResolvedValueOnce([{ active_merchants: 10000 }]);
      dataSource.query.mockResolvedValueOnce([]);
      dataSource.query.mockResolvedValueOnce([]);
      dataSource.query.mockResolvedValueOnce([]);
      dataSource.query.mockResolvedValueOnce([]);

      const result = await service.getMetrics(query);

      expect(result.volumeByCurrency[0].volume).toBe(999999999.99);
      expect(result.activeMerchants).toBe(10000);
    });

    it('should handle payment status variety', async () => {
      const query: GetMetricsDto = {
        from: '2026-01-01T00:00:00Z',
        to: '2026-01-31T23:59:59Z',
      };

      redisClient.get.mockResolvedValue(null);
      dataSource.query.mockResolvedValueOnce([]);
      dataSource.query.mockResolvedValueOnce([
        { status: 'COMPLETED', count: 150 },
        { status: 'PENDING', count: 20 },
        { status: 'FAILED', count: 5 },
        { status: 'CANCELLED', count: 3 },
        { status: 'REFUNDED', count: 10 },
      ]);
      dataSource.query.mockResolvedValueOnce([]);
      dataSource.query.mockResolvedValueOnce([]);
      dataSource.query.mockResolvedValueOnce([]);
      dataSource.query.mockResolvedValueOnce([]);
      dataSource.query.mockResolvedValueOnce([]);

      const result = await service.getMetrics(query);

      expect(result.paymentCountByStatus).toHaveLength(5);
    });
  });
});
