import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ThrottlerStorage } from '@nestjs/throttler/dist/throttler-storage.interface';
import { UsersService } from '../users/users.service';

@Injectable()
export class MerchantThrottlerGuard extends ThrottlerGuard {
  private readonly storage: ThrottlerStorage;

  constructor(
    storage: ThrottlerStorage,
    private readonly usersService: UsersService,
  ) {
    super(storage);
    this.storage = storage;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    
    // Extract merchant/user identifier from request
    // Priority: API key user > JWT user
    let userId: string | undefined;
    
    if (request.apiKey?.userId) {
      userId = request.apiKey.userId;
    } else if (request.user?.id) {
      userId = request.user.id;
    }

    // If we have a user, check for custom rate limits
    if (userId) {
      try {
        const user = await this.usersService.findOne(userId);
        
        // If user has custom rate limits enabled, use them
        if (user?.rateLimitEnabled && user.rateLimitLimit && user.rateLimitTtl) {
          // Store the merchant-specific limits in the request for later use
          request.merchantRateLimit = {
            limit: user.rateLimitLimit,
            ttl: user.rateLimitTtl,
          };
        }
      } catch (error) {
        // If we can't fetch user config, fall back to global defaults
        // Log but don't fail the request
        console.warn(`Failed to fetch rate limit config for user ${userId}:`, error);
      }
    }

    // Proceed with standard throttler guard logic
    return super.canActivate(context);
  }

  protected async resolveRequestTimeout(
    context: ExecutionContext,
    handler: Function,
  ): Promise<number> {
    const request = context.switchToHttp().getRequest();
    
    // If merchant has custom rate limits, use their TTL
    if (request.merchantRateLimit?.ttl) {
      return request.merchantRateLimit.ttl;
    }
    
    // Otherwise use default from throttler config
    return super.resolveRequestTimeout(context, handler);
  }

  protected async getTracker(
    req: any,
    limiter: { ttl: number; limit: number },
  ): Promise<{ totalHits: number; resetTime: Date }> {
    // If merchant has custom rate limits, use their limit
    if (req.merchantRateLimit?.limit) {
      const customLimiter = {
        ttl: req.merchantRateLimit.ttl || limiter.ttl,
        limit: req.merchantRateLimit.limit,
      };
      return super.getTracker(req, customLimiter);
    }
    
    return super.getTracker(req, limiter);
  }
}
