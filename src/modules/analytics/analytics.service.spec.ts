import { DataSource, Repository } from 'typeorm';
import { MerchantSettings } from '../merchants/entities/merchant-settings.entity';
import {
  AnalyticsGroupBy,
  AnalyticsInterval,
} from './dto/get-payment-analytics.dto';
import { AnalyticsService } from './analytics.service';

const bucketKey = '2026-01-01T00:00:00';

function createAnalyticsService(
  buckets: Array<{ key: string; start: Date }>,
  payments: Array<Record<string, string>> = [],
  refunds: Array<Record<string, string>> = [],
) {
  const query = jest.fn()
    .mockResolvedValueOnce(buckets)
    .mockResolvedValueOnce(payments)
    .mockResolvedValueOnce(refunds);
  const dataSource = { query } as unknown as DataSource;
  const settingsRepo = {
    findOne: jest.fn().mockResolvedValue({ timezone: 'UTC' }),
  } as unknown as Repository<MerchantSettings>;
  return { service: new AnalyticsService(dataSource, settingsRepo), query };
}

describe('AnalyticsService payment analytics', () => {
  it.each([
    AnalyticsInterval.HOUR,
    AnalyticsInterval.DAY,
    AnalyticsInterval.WEEK,
    AnalyticsInterval.MONTH,
  ])('returns buckets for the %s interval', async (interval) => {
    const start = new Date('2026-01-01T00:00:00.000Z');
    const { service, query } = createAnalyticsService([{ key: bucketKey, start }]);

    const result = await service.getPaymentAnalytics('merchant-id', {
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-01-03T00:00:00.000Z',
      interval,
      timezone: 'UTC',
    });

    expect(result.interval).toBe(interval);
    expect(result.series).toHaveLength(1);
    expect(result.series[0].buckets[0]).toMatchObject({
      start: start.toISOString(),
      localStart: bucketKey,
      count: 0,
      successCount: 0,
      successRate: null,
      averageTicket: null,
    });
    expect(query.mock.calls[0][1][0]).toBe(interval);
  });

  it('keeps local day boundaries across the spring DST transition', async () => {
    const buckets = [
      { key: '2026-03-08T00:00:00', start: new Date('2026-03-08T05:00:00.000Z') },
      { key: '2026-03-09T00:00:00', start: new Date('2026-03-09T04:00:00.000Z') },
    ];
    const { service, query } = createAnalyticsService(buckets);

    const result = await service.getPaymentAnalytics('merchant-id', {
      from: '2026-03-08T05:00:00.000Z',
      to: '2026-03-10T04:00:00.000Z',
      interval: AnalyticsInterval.DAY,
      timezone: 'America/New_York',
    });

    const [first, second] = result.series[0].buckets;
    expect(first.localStart).toBe('2026-03-08T00:00:00');
    expect(second.localStart).toBe('2026-03-09T00:00:00');
    expect(Date.parse(second.start) - Date.parse(first.start)).toBe(23 * 60 * 60 * 1000);
    expect(query.mock.calls[0][0]).toContain("AT TIME ZONE $2");
    expect(query.mock.calls[0][0]).toContain("('1 ' || $1)::interval");
  });

  it('applies currency and groupBy filters when aggregating success rates', async () => {
    const payments = [
      { key: bucketKey, grp: 'COMPLETED', count: '2', successCount: '2', gross: '100.00', fees: '2.00' },
      { key: bucketKey, grp: 'FAILED', count: '2', successCount: '0', gross: '0', fees: '0' },
    ];
    const refunds = [{ key: bucketKey, grp: 'COMPLETED', refunds: '10.00' }];
    const { service, query } = createAnalyticsService(
      [{ key: bucketKey, start: new Date('2026-01-01T00:00:00.000Z') }],
      payments,
      refunds,
    );

    const result = await service.getPaymentAnalytics('merchant-id', {
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-01-02T00:00:00.000Z',
      interval: AnalyticsInterval.DAY,
      timezone: 'UTC',
      currency: 'USD',
      groupBy: AnalyticsGroupBy.STATUS,
    });

    expect(query.mock.calls[1][0]).toContain('p."status"::text');
    expect(query.mock.calls[1][0]).toContain('p."currency" = $8');
    expect(query.mock.calls[1][1][7]).toBe('USD');
    expect(query.mock.calls[2][0]).toContain('p."currency" = $6');
    expect(query.mock.calls[2][1][5]).toBe('USD');
    expect(result.series).toEqual([
      expect.objectContaining({
        group: 'COMPLETED',
        buckets: [expect.objectContaining({ count: 2, successCount: 2, successRate: 1 })],
      }),
      expect.objectContaining({
        group: 'FAILED',
        buckets: [expect.objectContaining({ count: 2, successCount: 0, successRate: 0 })],
      }),
    ]);
  });

  it('returns a null success rate and average ticket when there are no payments', async () => {
    const { service } = createAnalyticsService([
      { key: bucketKey, start: new Date('2026-01-01T00:00:00.000Z') },
    ]);

    const result = await service.getPaymentAnalytics('merchant-id', {
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-01-02T00:00:00.000Z',
      interval: AnalyticsInterval.DAY,
      timezone: 'UTC',
    });

    expect(result.series[0].buckets[0]).toMatchObject({
      count: 0,
      successCount: 0,
      successRate: null,
      averageTicket: null,
    });
  });
});

describe('AnalyticsService refund and dispute analytics', () => {
  it('returns merchant-scoped counts, amounts, and rates per bucket', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce([
        { key: '2026-10-19T00:00:00', start: new Date('2026-10-19T00:00:00.000Z') },
      ])
      .mockResolvedValueOnce([{ key: '2026-10-19T00:00:00', count: 4 }])
      .mockResolvedValueOnce([{ key: '2026-10-19T00:00:00', count: 2, amount: '15.50' }])
      .mockResolvedValueOnce([{ key: '2026-10-19T00:00:00', count: 1, amount: '20.00' }]);
    const dataSource = { query } as unknown as DataSource;
    const settingsRepo = {
      findOne: jest.fn().mockResolvedValue({ timezone: 'UTC' }),
    } as unknown as Repository<MerchantSettings>;
    const service = new AnalyticsService(dataSource, settingsRepo);

    const result = await service.getRefundsDisputesAnalytics('merchant-id', {
      from: '2026-10-19T00:00:00.000Z',
      to: '2026-10-20T00:00:00.000Z',
      interval: AnalyticsInterval.DAY,
    });

    expect(result.buckets).toEqual([
      {
        start: '2026-10-19T00:00:00.000Z',
        localStart: '2026-10-19T00:00:00',
        refundCount: 2,
        refundAmount: '15.50',
        refundRate: 0.5,
        disputeCount: 1,
        disputeAmount: '20.00',
        disputeRate: 0.25,
      },
    ]);
    for (const [, params] of query.mock.calls.slice(1)) {
      expect(params[0]).toBe('merchant-id');
    }
    expect(query.mock.calls[2][0]).toContain('JOIN "payments" p ON p."id" = r."paymentId"');
    expect(query.mock.calls[3][0]).toContain('JOIN "payments" p ON p."id" = d."paymentId"');
  });
});