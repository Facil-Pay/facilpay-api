import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RatesRedisService implements OnModuleDestroy {
  private readonly client: Redis;

  constructor(private readonly configService: ConfigService) {
    this.client = new Redis({
      host: this.configService.get('REDIS_HOST', 'localhost'),
      port: this.configService.get('REDIS_PORT', 6379),
      maxRetriesPerRequest: 1,
    });
  }

  get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  set(key: string, value: string, ttlSeconds: number): Promise<void> {
    return this.client.set(key, value, 'EX', ttlSeconds).then(() => undefined);
  }

  onModuleDestroy(): void {
    this.client.disconnect();
  }
}
