import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as geoip from 'geoip-lite';

interface CacheEntry {
  country: string | null;
  expiresAt: number;
}

const DEFAULT_CACHE_TTL_SECONDS = 300;

@Injectable()
export class GeoLookupService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly configService: ConfigService) {}

  lookupCountry(ip: string): string | null {
    const cached = this.cache.get(ip);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.country;
    }

    const country = geoip.lookup(ip)?.country ?? null;
    const ttlSeconds = this.configService.get<number>(
      'GEO_LOOKUP_CACHE_TTL_SECONDS',
      DEFAULT_CACHE_TTL_SECONDS,
    );
    this.cache.set(ip, { country, expiresAt: Date.now() + ttlSeconds * 1000 });

    return country;
  }
}
