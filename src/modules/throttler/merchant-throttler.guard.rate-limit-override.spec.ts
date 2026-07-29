import { Reflector } from '@nestjs/core';
import { MerchantThrottlerGuard } from './merchant-throttler.guard';

describe('MerchantThrottlerGuard - rate limit overrides', () => {
  let guard: MerchantThrottlerGuard;
  let mockUsersService: { findOne: jest.Mock };
  let mockStorage: { increment: jest.Mock };

  const options = {
    throttlers: [{ name: 'default', ttl: 60000, limit: 100 }],
  };

  beforeEach(async () => {
    mockUsersService = { findOne: jest.fn() };
    mockStorage = {
      increment: jest.fn().mockResolvedValue({
        totalHits: 1,
        timeToExpire: 60,
        isBlocked: false,
        timeToBlockExpire: 0,
      }),
    };

    guard = new MerchantThrottlerGuard(
      options as any,
      mockStorage as any,
      new Reflector(),
      mockUsersService as any,
    );
    await (guard as any).onModuleInit();
  });

  const resolveOverride = (req: any) =>
    (guard as any).resolveRateLimitOverride(req);

  it('prefers the API key override over any user-level config', async () => {
    mockUsersService.findOne.mockResolvedValue({
      rateLimitEnabled: true,
      rateLimitLimit: 10,
      rateLimitTtl: 1000,
    });

    const override = await resolveOverride({
      apiKey: { userId: 'user-1', rateLimitLimit: 500, rateLimitTtl: 5000 },
    });

    expect(override).toEqual({ limit: 500, ttl: 5000 });
    expect(mockUsersService.findOne).not.toHaveBeenCalled();
  });

  it('falls back to the default throttler ttl when the API key sets only a limit', async () => {
    const override = await resolveOverride({
      apiKey: { userId: 'user-1', rateLimitLimit: 500, rateLimitTtl: null },
    });

    expect(override).toEqual({ limit: 500, ttl: 60000 });
  });

  it('falls back to the per-user override when no API key override is set', async () => {
    mockUsersService.findOne.mockResolvedValue({
      rateLimitEnabled: true,
      rateLimitLimit: 10,
      rateLimitTtl: 1000,
    });

    const override = await resolveOverride({ user: { id: 'user-1' } });

    expect(override).toEqual({ limit: 10, ttl: 1000 });
    expect(mockUsersService.findOne).toHaveBeenCalledWith('user-1');
  });

  it('returns null when neither an API key nor a user override applies', async () => {
    mockUsersService.findOne.mockResolvedValue({ rateLimitEnabled: false });

    const override = await resolveOverride({ user: { id: 'user-1' } });

    expect(override).toBeNull();
  });

  it('returns null for anonymous requests without hitting the user lookup', async () => {
    const override = await resolveOverride({});

    expect(override).toBeNull();
    expect(mockUsersService.findOne).not.toHaveBeenCalled();
  });

  it('only overrides the default throttler bucket, not named buckets like auth', async () => {
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          apiKey: { userId: 'user-1', rateLimitLimit: 500, rateLimitTtl: 5000 },
        }),
        getResponse: () => ({ header: jest.fn() }),
      }),
    } as any;

    const superHandleRequest = jest.spyOn(
      Object.getPrototypeOf(Object.getPrototypeOf(guard)),
      'handleRequest',
    );

    await (guard as any).handleRequest({
      context,
      limit: 5,
      ttl: 900000,
      throttler: { name: 'auth' },
      blockDuration: 900000,
      getTracker: async () => 'tracker',
      generateKey: () => 'key',
    });

    expect(superHandleRequest).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 5, ttl: 900000 }),
    );

    superHandleRequest.mockRestore();
  });
});
