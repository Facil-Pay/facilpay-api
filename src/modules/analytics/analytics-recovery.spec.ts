import { BadRequestException } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';

describe('AnalyticsService checkout recovery', () => {
  let service: AnalyticsService;
  let sessionRepo: any;

  beforeEach(() => {
    sessionRepo = { count: jest.fn().mockResolvedValue(0) };
    service = new AnalyticsService({} as any, {} as any, sessionRepo);
  });

  it('reports counts and the recovery rate for the requested range', async () => {
    sessionRepo.count
      .mockResolvedValueOnce(100)
      .mockResolvedValueOnce(80)
      .mockResolvedValueOnce(20);

    const result = await service.getCheckoutRecoveryAnalytics('merchant-1', {
      from: '2026-11-01T00:00:00.000Z',
      to: '2026-11-20T00:00:00.000Z',
    });

    expect(result).toEqual({
      from: '2026-11-01T00:00:00.000Z',
      to: '2026-11-20T00:00:00.000Z',
      expiredSessionsWithEmail: 100,
      recoveryEmailsSent: 80,
      recoveredSessions: 20,
      recoveryRate: 0.25,
    });
    expect(sessionRepo.count).toHaveBeenCalledTimes(3);
  });

  it('reports a null rate when no recovery emails were sent', async () => {
    const result = await service.getCheckoutRecoveryAnalytics('merchant-1', {
      from: '2026-11-01T00:00:00.000Z',
      to: '2026-11-20T00:00:00.000Z',
    });

    expect(result.recoveryRate).toBeNull();
  });

  it('rejects an invalid range', async () => {
    await expect(
      service.getCheckoutRecoveryAnalytics('merchant-1', {
        from: '2026-11-20T00:00:00.000Z',
        to: '2026-11-01T00:00:00.000Z',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(sessionRepo.count).not.toHaveBeenCalled();
  });
});
