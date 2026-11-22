import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as StellarSdk from '@stellar/stellar-sdk';

interface UrlHealth {
  url: string;
  healthy: boolean;
  lastChecked: Date;
  unhealthySince?: Date;
  errorCount: number;
}

export type PathQuoteMode = 'strict-send' | 'strict-receive';

export interface PathQuoteResult {
  mode: PathQuoteMode;
  sourceAsset: string;
  destAsset: string;
  amount: string;
  sourceAmount: string;
  destAmount: string;
  path: Array<{ assetCode: string; assetIssuer: string | null; native: boolean }>;
  slippageEstimatePercent: number | null;
  slippageEstimateBasis: 'next-best-path' | 'unavailable';
  cached: boolean;
}

interface HorizonPathRecord {
  source_amount: string;
  destination_amount: string;
  path?: Array<{
    asset_type: string;
    asset_code?: string;
    asset_issuer?: string;
  }>;
}

const PATH_QUOTE_TTL_MS = 10_000;
const PATH_QUOTE_CACHE_MAX = 500;

@Injectable()
export class StellarHorizonClientService {
  private readonly logger = new Logger(StellarHorizonClientService.name);
  private urls: string[];
  private urlHealth: Map<string, UrlHealth> = new Map();
  private readonly cooldownMs = 30000; // 30 seconds
  private currentIndex = 0;
  private readonly pathQuoteCache = new Map<
    string,
    { expiresAt: number; result: Omit<PathQuoteResult, 'cached'> }
  >();

  constructor(private readonly configService: ConfigService) {
    this.urls = this.parseHorizonUrls();
    this.initializeHealthMap();
  }

  private parseHorizonUrls(): string[] {
    const urlsEnv = this.configService.get<string>('STELLAR_HORIZON_URLS');
    const singleUrl = this.configService.get<string>('STELLAR_HORIZON_URL');

    if (urlsEnv) {
      return urlsEnv.split(',').map(url => url.trim());
    } else if (singleUrl) {
      return [singleUrl];
    }

    return ['https://horizon-testnet.stellar.org'];
  }

  private initializeHealthMap(): void {
    for (const url of this.urls) {
      this.urlHealth.set(url, {
        url,
        healthy: true,
        lastChecked: new Date(),
        errorCount: 0,
      });
    }
  }

  getHealthyServer(): StellarSdk.Horizon.Server {
    const healthyUrl = this.getHealthyUrl();
    return new StellarSdk.Horizon.Server(healthyUrl);
  }

  async getPathQuote(
    sourceAssetInput: string,
    destAssetInput: string,
    amount: string,
    mode: PathQuoteMode,
  ): Promise<PathQuoteResult> {
    if (mode !== 'strict-send' && mode !== 'strict-receive') {
      throw new BadRequestException('mode must be strict-send or strict-receive');
    }
    if (!/^\d+(\.\d{1,7})?$/.test(amount) || Number(amount) <= 0) {
      throw new BadRequestException('amount must be a positive decimal with up to 7 fractional digits');
    }

    const source = this.parseAsset(sourceAssetInput);
    const destination = this.parseAsset(destAssetInput);
    const cacheKey = JSON.stringify([source.normalized, destination.normalized, amount, mode]);
    const now = Date.now();
    const cached = this.pathQuoteCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return { ...cached.result, path: [...cached.result.path], cached: true };
    }
    if (cached) this.pathQuoteCache.delete(cacheKey);

    const server = this.getHealthyServer();
    const response = mode === 'strict-send'
      ? await server.strictSendPaths(source.asset, [destination.asset], amount).call()
      : await server.strictReceivePaths([source.asset], destination.asset, amount).call();
    const records = (response.records ?? []) as HorizonPathRecord[];
    if (records.length === 0) {
      throw new NotFoundException('No payment path is available for the requested assets and amount');
    }

    const ranked = records
      .filter((record) => Number.isFinite(Number(record.source_amount)) && Number.isFinite(Number(record.destination_amount)))
      .sort((a, b) => mode === 'strict-send'
        ? Number(b.destination_amount) - Number(a.destination_amount)
        : Number(a.source_amount) - Number(b.source_amount));
    const best = ranked[0];
    if (!best) {
      throw new NotFoundException('Horizon returned no valid payment paths');
    }
    const nextBest = ranked[1];
    const bestBasisAmount = Number(mode === 'strict-send' ? best.destination_amount : best.source_amount);
    const nextBasisAmount = nextBest
      ? Number(mode === 'strict-send' ? nextBest.destination_amount : nextBest.source_amount)
      : null;
    const slippageEstimatePercent = nextBasisAmount !== null && bestBasisAmount > 0
      ? Number((Math.abs(nextBasisAmount - bestBasisAmount) / bestBasisAmount * 100).toFixed(4))
      : null;
    const result: Omit<PathQuoteResult, 'cached'> = {
      mode,
      sourceAsset: source.normalized,
      destAsset: destination.normalized,
      amount,
      sourceAmount: best.source_amount,
      destAmount: best.destination_amount,
      path: (best.path ?? []).map((asset) => ({
        assetCode: asset.asset_type === 'native' ? 'XLM' : asset.asset_code ?? '',
        assetIssuer: asset.asset_type === 'native' ? null : asset.asset_issuer ?? null,
        native: asset.asset_type === 'native',
      })),
      slippageEstimatePercent,
      slippageEstimateBasis: nextBest ? 'next-best-path' : 'unavailable',
    };

    if (this.pathQuoteCache.size >= PATH_QUOTE_CACHE_MAX) {
      const oldestKey = this.pathQuoteCache.keys().next().value;
      if (oldestKey !== undefined) this.pathQuoteCache.delete(oldestKey);
    }
    this.pathQuoteCache.set(cacheKey, { expiresAt: now + PATH_QUOTE_TTL_MS, result });
    return { ...result, path: [...result.path], cached: false };
  }

  private parseAsset(input: string): {
    asset: StellarSdk.Asset;
    normalized: string;
  } {
    if (typeof input !== 'string') {
      throw new BadRequestException('Asset must be XLM or CODE:ISSUER');
    }
    const value = input.trim();
    if (value.toUpperCase() === 'XLM') {
      return { asset: StellarSdk.Asset.native(), normalized: 'XLM' };
    }

    const separator = value.indexOf(':');
    if (separator <= 0 || separator !== value.lastIndexOf(':')) {
      throw new BadRequestException('Issued assets must use CODE:ISSUER format');
    }
    const code = value.slice(0, separator).toUpperCase();
    const issuer = value.slice(separator + 1);
    if (!/^[A-Z0-9]{1,12}$/.test(code)) {
      throw new BadRequestException('Asset code must contain 1 to 12 alphanumeric characters');
    }
    if (!StellarSdk.StrKey.isValidEd25519PublicKey(issuer)) {
      throw new BadRequestException('Asset issuer must be a valid Stellar public key');
    }
    return {
      asset: new StellarSdk.Asset(code, issuer),
      normalized: `${code}:${issuer}`,
    };
  }

  private getHealthyUrl(): string {
    const now = new Date();
    let attempts = 0;

    while (attempts < this.urls.length) {
      const url = this.urls[this.currentIndex % this.urls.length];
      const health = this.urlHealth.get(url)!;

      if (health.healthy) {
        return url;
      }

      if (health.unhealthySince && now.getTime() - health.unhealthySince.getTime() > this.cooldownMs) {
        this.logger.log(`Retrying previously unhealthy URL: ${url}`);
        health.healthy = true;
        health.unhealthySince = undefined;
        health.errorCount = 0;
        return url;
      }

      this.currentIndex++;
      attempts++;
    }

    this.logger.warn('All Horizon URLs unhealthy, returning first URL');
    return this.urls[0];
  }

  recordSuccess(url?: string): void {
    const targetUrl = url || this.urls[this.currentIndex % this.urls.length];
    const health = this.urlHealth.get(targetUrl);
    if (health) {
      health.healthy = true;
      health.errorCount = 0;
      health.unhealthySince = undefined;
      health.lastChecked = new Date();
    }
  }

  recordFailure(url?: string): void {
    const targetUrl = url || this.urls[this.currentIndex % this.urls.length];
    const health = this.urlHealth.get(targetUrl);
    if (health) {
      health.errorCount++;
      health.lastChecked = new Date();

      if (!health.unhealthySince) {
        health.unhealthySince = new Date();
      }

      if (health.errorCount >= 3) {
        health.healthy = false;
        this.logger.warn(`Marking Horizon URL as unhealthy after ${health.errorCount} errors: ${targetUrl}`);
      }
    }

    this.currentIndex++;
  }

  getStatus(): Array<{ url: string; healthy: boolean; errorCount: number; lastChecked: string }> {
    return this.urls.map(url => {
      const health = this.urlHealth.get(url)!;
      return {
        url,
        healthy: health.healthy,
        errorCount: health.errorCount,
        lastChecked: health.lastChecked.toISOString(),
      };
    });
  }
}
