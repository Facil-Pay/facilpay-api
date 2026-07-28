import { Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
} from '@nestjs/throttler';
import type {
  ThrottlerModuleOptions,
  ThrottlerRequest,
  ThrottlerStorage,
} from '@nestjs/throttler';
import { UsersService } from '../users/users.service';

interface RateLimitOverride {
  limit: number;
  ttl: number;
}

@Injectable()
export class MerchantThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly usersService: UsersService,
  ) {
    super(options, storageService, reflector);
  }

  protected async handleRequest(
    requestProps: ThrottlerRequest,
  ): Promise<boolean> {
    // Overrides only apply to the general-purpose 'default' throttler bucket;
    // dedicated buckets (auth, webhook, bulk) keep their fixed limits.
    if (requestProps.throttler.name === 'default') {
      const { req } = this.getRequestResponse(requestProps.context);
      const override = await this.resolveRateLimitOverride(req);
      if (override) {
        return super.handleRequest({
          ...requestProps,
          limit: override.limit,
          ttl: override.ttl,
        });
      }
    }

    return super.handleRequest(requestProps);
  }

  private async resolveRateLimitOverride(
    req: any,
  ): Promise<RateLimitOverride | null> {
    // A per-API-key rate limit override takes precedence over everything else.
    if (req.apiKey?.rateLimitLimit) {
      return {
        limit: req.apiKey.rateLimitLimit,
        ttl: req.apiKey.rateLimitTtl || this.getDefaultTtl(),
      };
    }

    const userId = req.apiKey?.userId ?? req.user?.id;
    if (!userId) {
      return null;
    }

    try {
      const user = await this.usersService.findOne(userId);
      if (user?.rateLimitEnabled && user.rateLimitLimit && user.rateLimitTtl) {
        return { limit: user.rateLimitLimit, ttl: user.rateLimitTtl };
      }
    } catch (error) {
      // If we can't fetch user config, fall back to global defaults
      console.warn(`Failed to fetch rate limit config for user ${userId}:`, error);
    }

    return null;
  }

  private getDefaultTtl(): number {
    const defaultThrottler = this.throttlers.find((t) => t.name === 'default');
    return Number(defaultThrottler?.ttl ?? 60000);
  }
}
