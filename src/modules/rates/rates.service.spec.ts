import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { ServiceUnavailableException } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { RatesService } from './rates.service';
import { RatesRedisService } from './rates-redis.service';
import { AppLogger } from '../logger/logger.service';

describe('RatesService', () => {
  let service: RatesService;
  let mockRedisService: { get: jest.Mock; set: jest.Mock };
  let mockHttpService: { get: jest.Mock };

  const mockAppLogger = {
    child: jest.fn(() => ({
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
    })),
  };

  const mockConfigService = {
    get: jest.fn((_key: string, defaultValue: unknown) => defaultValue),
  };

  beforeEach(async () => {
    mockRedisService = {
      get: jest.fn(),
      set: jest.fn().mockResolvedValue(undefined),
    };
    mockHttpService = {
      get: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RatesService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: HttpService, useValue: mockHttpService },
        { provide: RatesRedisService, useValue: mockRedisService },
        { provide: AppLogger, useValue: mockAppLogger },
      ],
    }).compile();

    service = module.get<RatesService>(RatesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getRate', () => {
    it('should return the cached rate on a cache hit without calling the provider', async () => {
      mockRedisService.get.mockResolvedValueOnce('8.42');

      const result = await service.getRate('usd', 'xlm');

      expect(result).toEqual({ from: 'USD', to: 'XLM', rate: 8.42, source: 'cache' });
      expect(mockHttpService.get).not.toHaveBeenCalled();
    });

    it('should fetch from the provider and cache it on a cache miss', async () => {
      mockRedisService.get.mockResolvedValueOnce(null);
      mockHttpService.get.mockReturnValueOnce(
        of({ data: { rates: { XLM: 9.1 } } } as any),
      );

      const result = await service.getRate('USD', 'XLM');

      expect(result).toEqual({ from: 'USD', to: 'XLM', rate: 9.1, source: 'provider' });
      expect(mockRedisService.set).toHaveBeenCalledWith('fx:rate:USD:XLM', '9.1', 60);
      expect(mockRedisService.set).toHaveBeenCalledWith(
        'fx:fallback:USD:XLM',
        '9.1',
        60 * 60 * 24 * 7,
      );
    });

    it('should fall back to the last known cached value if the provider is unavailable', async () => {
      mockRedisService.get
        .mockResolvedValueOnce(null) // current cache miss
        .mockResolvedValueOnce('7.5'); // fallback hit
      mockHttpService.get.mockReturnValueOnce(
        throwError(() => new Error('provider down')),
      );

      const result = await service.getRate('USD', 'XLM');

      expect(result).toEqual({ from: 'USD', to: 'XLM', rate: 7.5, source: 'fallback' });
    });

    it('should throw ServiceUnavailableException when the provider fails and no fallback exists', async () => {
      mockRedisService.get.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      mockHttpService.get.mockReturnValueOnce(
        throwError(() => new Error('provider down')),
      );

      await expect(service.getRate('USD', 'XLM')).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });
});
