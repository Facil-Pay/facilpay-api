jest.mock('../../tracing', () => ({
  getTraceId: jest.fn(),
  initializeTracing: jest.fn(),
  runWithTrace: (_name: string, fn: () => unknown) => fn(),
}));

import {
  EmailNotificationService,
  getLocalDateAndHour,
  summarizeDigestNotifications,
} from './email-notification.service';
import { InAppNotificationType } from './in-app-notification.entity';
import { NotificationCategory } from './notification-preference.entity';
import { NotificationPreferencesService } from './notification-preferences.service';

describe('Daily Digest Email Notifications (#554)', () => {
  it('defaults digest preference to false while keeping standard categories true', async () => {
    const repo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      upsert: jest.fn(),
    };
    const prefsService = new NotificationPreferencesService(repo as never);

    const prefs = await prefsService.getForUser('u1');
    expect(prefs[NotificationCategory.DIGEST]).toBe(false);
    expect(prefs[NotificationCategory.PAYMENTS]).toBe(true);
    expect(prefs[NotificationCategory.SECURITY]).toBe(true);
  });

  it('suppresses per-event non-security emails when digest preference is enabled', async () => {
    const repo = {
      find: jest.fn(),
      findOne: jest.fn(async ({ where }: { where: { category: NotificationCategory } }) => {
        if (where.category === NotificationCategory.DIGEST) {
          return { category: NotificationCategory.DIGEST, email: true };
        }
        return { category: where.category, email: true };
      }),
      upsert: jest.fn(),
    };
    const prefsService = new NotificationPreferencesService(repo as never);

    await expect(
      prefsService.isEmailEnabled('u1', NotificationCategory.PAYMENTS),
    ).resolves.toBe(false);
    await expect(
      prefsService.isEmailEnabled('u1', NotificationCategory.SECURITY),
    ).resolves.toBe(true);
  });

  it('summarises notification counts by type and highlights failures/disputes', () => {
    const summary = summarizeDigestNotifications(
      'merchant-1',
      '2026-10-20',
      'America/New_York',
      [
        {
          id: 'n1',
          type: InAppNotificationType.PAYMENT_RECEIVED,
          title: 'Payment Received: 50 USDC',
          body: 'Payment p1 received',
          createdAt: new Date('2026-10-20T10:00:00.000Z'),
        },
        {
          id: 'n2',
          type: InAppNotificationType.PAYMENT_RECEIVED,
          title: 'Payment Received: 75 USDC',
          body: 'Payment p2 received',
          createdAt: new Date('2026-10-20T11:00:00.000Z'),
        },
        {
          id: 'n3',
          type: InAppNotificationType.DISPUTE_OPENED,
          title: 'Dispute opened on payment p2',
          body: 'Action required: payment dispute failure alert',
          createdAt: new Date('2026-10-20T12:00:00.000Z'),
        },
      ],
    );

    expect(summary.totalCount).toBe(3);
    expect(summary.countsByType).toEqual({
      [InAppNotificationType.PAYMENT_RECEIVED]: 2,
      [InAppNotificationType.DISPUTE_OPENED]: 1,
    });
    expect(summary.failureCount).toBe(1);
    expect(summary.failures[0]).toMatchObject({
      id: 'n3',
      type: InAppNotificationType.DISPUTE_OPENED,
    });
  });

  it('respects merchant timezone and sends at most once per local calendar day per user', async () => {
    // 2026-10-20T12:00:00Z is 08:00 in America/New_York (EDT, UTC-4) and 12:00 in UTC
    const now = new Date('2026-10-20T12:00:00.000Z');
    expect(getLocalDateAndHour(now, 'America/New_York')).toEqual({
      localDate: '2026-10-20',
      hour: 8,
    });
    expect(getLocalDateAndHour(now, 'UTC')).toEqual({
      localDate: '2026-10-20',
      hour: 12,
    });

    const emailQueue = { add: jest.fn().mockResolvedValue({ id: 'job-1' }) };
    const prefsService = {
      listDigestSubscribers: jest.fn().mockResolvedValue(['u-ny', 'u-utc']),
    };
    const inAppService = { create: jest.fn() };
    const appLogger = {
      child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
    };
    const dataSource = {
      query: jest.fn(async (sql: string, params: unknown[]) => {
        if (sql.includes('FROM "users"')) {
          const userId = params[0];
          if (userId === 'u-ny') {
            return [{ id: 'u-ny', email: 'ny@merchant.com', timezone: 'America/New_York' }];
          }
          return [{ id: 'u-utc', email: 'utc@merchant.com', timezone: 'UTC' }];
        }
        if (sql.includes('FROM "in_app_notifications"')) {
          return [
            {
              id: 'n1',
              type: InAppNotificationType.PAYMENT_RECEIVED,
              title: 'Payment Received: 100 USDC',
              body: 'Payment ok',
              createdAt: new Date('2026-10-20T05:00:00.000Z'),
            },
            {
              id: 'n2',
              type: InAppNotificationType.DISPUTE_OPENED,
              title: 'Dispute opened',
              body: 'Payment failed / disputed',
              createdAt: new Date('2026-10-20T06:00:00.000Z'),
            },
          ];
        }
        return [];
      }),
    };

    const service = new EmailNotificationService(
      emailQueue as never,
      prefsService as never,
      inAppService as never,
      appLogger as never,
      dataSource as never,
    );

    // First run at 12:00 UTC -> 08:00 America/New_York (sends for u-ny, skips u-utc)
    const firstSent = await service.runScheduledDailyDigests(now, 8);
    expect(firstSent).toBe(1);
    expect(emailQueue.add).toHaveBeenCalledTimes(1);
    expect(emailQueue.add).toHaveBeenCalledWith(
      'send',
      expect.objectContaining({
        to: 'ny@merchant.com',
        templateName: 'daily-digest',
        subject:
          'Daily Notification Digest (2026-10-20): 2 events (1 attention required)',
      }),
      expect.anything(),
    );

    // Second run on the same local day -> deduplicated (0 sent)
    const secondSent = await service.runScheduledDailyDigests(now, 8);
    expect(secondSent).toBe(0);
    expect(emailQueue.add).toHaveBeenCalledTimes(1);
  });
});
