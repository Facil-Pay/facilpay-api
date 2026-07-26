import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { Cron, CronExpression } from '@nestjs/schedule';
import { firstValueFrom } from 'rxjs';
import { AppLogger } from '../logger/logger.service';
import { Logger } from 'pino';
import { RatesRedisService } from './rates-redis.service';

export interface RateResult {
  from: string;
  to: string;
  rate: number;
  source: 'cache' | 'provider' | 'fallback';
}

const DEFAULT_TTL_SECONDS = 60;
const FALLBACK_TTL_SECONDS = 60 * 60 * 24 * 7;

@Injectable()
export class RatesService {
  private readonly logger: Logger;
  private readonly trackedPairs = new Set<string>();

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    private readonly redisService: RatesRedisService,
    appLogger: AppLogger,
  ) {
    this.logger = appLogger.child({ module: RatesService.name });
  }

  async getRate(from: string, to: string): Promise<RateResult> {
    const fromCode = from.toUpperCase();
    const toCode = to.toUpperCase();
    const cacheKey = this.buildCacheKey(fromCode, toCode);

    this.trackedPairs.add(cacheKey);

    const cached = await this.redisService.get(cacheKey);
    if (cached !== null) {
      return { from: fromCode, to: toCode, rate: Number(cached), source: 'cache' };
    }

    this.logger.warn({ from: fromCode, to: toCode }, 'FX rate cache miss');

    try {
      const rate = await this.fetchAndCacheRate(fromCode, toCode);
      return { from: fromCode, to: toCode, rate, source: 'provider' };
    } catch (error) {
      const fallback = await this.redisService.get(this.buildFallbackKey(fromCode, toCode));
      if (fallback !== null) {
        this.logger.warn(
          { from: fromCode, to: toCode },
          'FX provider unavailable, serving previously cached fallback rate',
        );
        return { from: fromCode, to: toCode, rate: Number(fallback), source: 'fallback' };
      }

      this.logger.error(
        { from: fromCode, to: toCode, error: error instanceof Error ? error.message : error },
        'FX provider unavailable and no fallback rate cached',
      );
      throw new ServiceUnavailableException(
        `Unable to retrieve exchange rate for ${fromCode}/${toCode}`,
      );
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async refreshTrackedRates(): Promise<void> {
    for (const key of this.trackedPairs) {
      const [, , from, to] = key.split(':');
      try {
        await this.fetchAndCacheRate(from, to);
      } catch {
        // Keep serving the existing fallback value; nothing further to do here.
      }
    }
  }

  private async fetchAndCacheRate(from: string, to: string): Promise<number> {
    const providerUrl = this.configService.get<string>(
      'FX_PROVIDER_URL',
      'https://api.exchangerate.host/latest',
    );
    const ttlSeconds = this.configService.get<number>(
      'FX_RATE_CACHE_TTL_SECONDS',
      DEFAULT_TTL_SECONDS,
    );

    const response = await firstValueFrom(
      this.httpService.get(providerUrl, {
        params: { base: from, symbols: to },
        timeout: 5000,
      }),
    );

    const rate = response.data?.rates?.[to];
    if (typeof rate !== 'number') {
      throw new Error(`Provider response did not include a rate for ${from}/${to}`);
    }

    await this.redisService.set(this.buildCacheKey(from, to), String(rate), ttlSeconds);
    await this.redisService.set(
      this.buildFallbackKey(from, to),
      String(rate),
      FALLBACK_TTL_SECONDS,
    );

    return rate;
  }

  private buildCacheKey(from: string, to: string): string {
    return `fx:rate:${from}:${to}`;
  }

  private buildFallbackKey(from: string, to: string): string {
    return `fx:fallback:${from}:${to}`;
  }
}
