import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { AppLogger } from '../logger/logger.service';
import { Logger } from 'pino';

@Injectable()
export class AnalyticsCacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger: Logger;
  private client: Redis;

  constructor(
    private readonly configService: ConfigService,
    appLogger: AppLogger,
  ) {
    this.logger = appLogger.child({ module: AnalyticsCacheService.name });
  }

  onModuleInit(): void {
    const host = this.configService.get<string>('REDIS_HOST', 'localhost');
    const port = this.configService.get<number>('REDIS_PORT', 6379);

    this.client = new Redis({ host, port, lazyConnect: true });

    this.client.on('error', (err: Error) => {
      this.logger.error({ err }, 'Redis connection error in analytics cache');
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      await this.client.quit();
    }
  }

  /**
   * Retrieve a cached value. Returns null on cache miss or Redis error.
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.client.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch (err) {
      this.logger.warn({ err, key }, 'Cache GET failed, treating as miss');
      return null;
    }
  }

  /**
   * Store a value in cache with a TTL in seconds. Silently ignores Redis errors.
   */
  async set(key: string, value: unknown, ttlSeconds = 60): Promise<void> {
    try {
      await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (err) {
      this.logger.warn({ err, key }, 'Cache SET failed, skipping cache write');
    }
  }
}
