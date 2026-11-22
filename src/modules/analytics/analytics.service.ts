import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { MerchantSettings } from '../merchants/entities/merchant-settings.entity';
import { PaymentStatus } from '../payments/payment.entity';
import {
  AnalyticsGroupBy,
  AnalyticsInterval,
  GetPaymentAnalyticsDto,
} from './dto/get-payment-analytics.dto';

const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 1000;
const MAX_BUCKETS = 1000;
const DEFAULT_RANGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Payments whose funds were captured (refunds are reported separately). */
const SUCCESS_STATUSES = [
  PaymentStatus.COMPLETED,
  PaymentStatus.PARTIALLY_REFUNDED,
  PaymentStatus.REFUNDED,
];

/** Payments still in flight are excluded from the success-rate denominator. */
const UNSETTLED_STATUSES = [PaymentStatus.PENDING, PaymentStatus.OVERDUE];

const APPROX_BUCKET_MS: Record<AnalyticsInterval, number> = {
  [AnalyticsInterval.HOUR]: 60 * 60 * 1000,
  [AnalyticsInterval.DAY]: 24 * 60 * 60 * 1000,
  [AnalyticsInterval.WEEK]: 7 * 24 * 60 * 60 * 1000,
  [AnalyticsInterval.MONTH]: 28 * 24 * 60 * 60 * 1000,
};

/** Whitelisted SQL for each groupBy option (never interpolate user input). */
const GROUP_EXPRESSIONS: Record<AnalyticsGroupBy | 'none', string> = {
  none: 'NULL::text',
  [AnalyticsGroupBy.STATUS]: 'p."status"::text',
  [AnalyticsGroupBy.CURRENCY]: 'p."currency"',
  [AnalyticsGroupBy.PAYMENT_LINK]: `COALESCE(p."paymentLinkId", 'none')`,
};

export interface AnalyticsBucket {
  /** Bucket start as a UTC instant. */
  start: string;
  /** Bucket start as wall-clock time in the requested timezone. */
  localStart: string;
  gross: string;
  fees: string;
  refunds: string;
  net: string;
  count: number;
  successCount: number;
  successRate: number | null;
  averageTicket: string | null;
}

export interface AnalyticsSeries {
  group: string | null;
  buckets: AnalyticsBucket[];
}

export interface PaymentAnalyticsResult {
  from: string;
  to: string;
  interval: AnalyticsInterval;
  timezone: string;
  currency: string | null;
  groupBy: AnalyticsGroupBy | null;
  series: AnalyticsSeries[];
}

export interface RefundsDisputesBucket {
  start: string;
  localStart: string;
  refundCount: number;
  refundAmount: string;
  refundRate: number | null;
  disputeCount: number;
  disputeAmount: string;
  disputeRate: number | null;
}

export interface RefundsDisputesAnalyticsResult {
  from: string;
  to: string;
  interval: AnalyticsInterval;
  timezone: string;
  currency: string | null;
  buckets: RefundsDisputesBucket[];
}

interface Aggregate {
  gross: number;
  fees: number;
  refunds: number;
  count: number;
  successCount: number;
}

@Injectable()
export class AnalyticsService {
  private readonly cache = new Map<string, { expiresAt: number; value: PaymentAnalyticsResult }>();

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(MerchantSettings)
    private readonly settingsRepo: Repository<MerchantSettings>,
  ) {}

  async getPaymentAnalytics(
    merchantId: string,
    dto: GetPaymentAnalyticsDto,
  ): Promise<PaymentAnalyticsResult> {
    const interval = dto.interval ?? AnalyticsInterval.DAY;
    const to = dto.to ? new Date(dto.to) : new Date();
    const from = dto.from ? new Date(dto.from) : new Date(to.getTime() - DEFAULT_RANGE_MS);
    if (from >= to) {
      throw new BadRequestException('`from` must be before `to`');
    }
    if ((to.getTime() - from.getTime()) / APPROX_BUCKET_MS[interval] > MAX_BUCKETS) {
      throw new BadRequestException(
        `Range too large for interval "${interval}" (max ${MAX_BUCKETS} buckets)`,
      );
    }

    const timezone = dto.timezone ?? (await this.getMerchantTimezone(merchantId));
    const currency = dto.currency ?? null;
    const groupBy = dto.groupBy ?? null;

    const cacheKey = JSON.stringify([
      merchantId,
      from.toISOString(),
      to.toISOString(),
      interval,
      timezone,
      currency,
      groupBy,
    ]);
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const result = await this.query(merchantId, from, to, interval, timezone, currency, groupBy);
    this.remember(cacheKey, result);
    return result;
  }

  async getRefundsDisputesAnalytics(
    merchantId: string,
    dto: GetPaymentAnalyticsDto,
  ): Promise<RefundsDisputesAnalyticsResult> {
    const interval = dto.interval ?? AnalyticsInterval.DAY;
    const to = dto.to ? new Date(dto.to) : new Date();
    const from = dto.from ? new Date(dto.from) : new Date(to.getTime() - DEFAULT_RANGE_MS);
    if (from >= to) {
      throw new BadRequestException('`from` must be before `to`');
    }
    if ((to.getTime() - from.getTime()) / APPROX_BUCKET_MS[interval] > MAX_BUCKETS) {
      throw new BadRequestException(
        `Range too large for interval "${interval}" (max ${MAX_BUCKETS} buckets)`,
      );
    }

    const timezone = dto.timezone ?? (await this.getMerchantTimezone(merchantId));
    const currency = dto.currency ?? null;
    const keyFormat = `'YYYY-MM-DD"T"HH24:MI:SS'`;
    const localBucket = (column: string) =>
      `date_trunc($2, ${column} AT TIME ZONE 'UTC' AT TIME ZONE $3)`;
    const bucketRows: { key: string; start: Date }[] = await this.dataSource.query(
      `SELECT to_char(gs, ${keyFormat}) AS key, (gs AT TIME ZONE $2) AS start
         FROM generate_series(
                date_trunc($1, $3::timestamptz AT TIME ZONE $2),
                date_trunc($1, ($4::timestamptz - interval '1 microsecond') AT TIME ZONE $2),
                ('1 ' || $1)::interval
              ) AS gs
        ORDER BY gs`,
      [interval, timezone, from, to],
    );

    const baseParams: unknown[] = [merchantId, interval, timezone, from, to];
    const paymentParams = currency ? [...baseParams, SUCCESS_STATUSES, currency] : [...baseParams, SUCCESS_STATUSES];
    const eventParams = currency ? [...baseParams, currency] : baseParams;
    const paymentCurrencyFilter = currency ? 'AND p."currency" = $7' : '';
    const eventCurrencyFilter = currency ? 'AND p."currency" = $6' : '';
    const [paymentRows, refundRows, disputeRows] = await Promise.all([
      this.dataSource.query(
        `SELECT to_char(${localBucket('p."createdAt"')}, ${keyFormat}) AS key,
                COUNT(*)::int AS count
           FROM "payments" p
          WHERE p."merchantId" = $1
            AND p."status" = ANY($6)
            AND p."createdAt" >= ($4::timestamptz AT TIME ZONE 'UTC')
            AND p."createdAt" < ($5::timestamptz AT TIME ZONE 'UTC')
            ${paymentCurrencyFilter}
          GROUP BY 1`,
        paymentParams,
      ),
      this.dataSource.query(
        `SELECT to_char(${localBucket('r."createdAt"')}, ${keyFormat}) AS key,
                COUNT(DISTINCT r."paymentId")::int AS count,
                COALESCE(SUM(r."amount"), 0)::text AS amount
           FROM "refunds" r
           JOIN "payments" p ON p."id" = r."paymentId"
          WHERE p."merchantId" = $1
            AND r."createdAt" >= ($4::timestamptz AT TIME ZONE 'UTC')
            AND r."createdAt" < ($5::timestamptz AT TIME ZONE 'UTC')
            ${eventCurrencyFilter}
          GROUP BY 1`,
        eventParams,
      ),
      this.dataSource.query(
        `SELECT to_char(${localBucket('d."createdAt"')}, ${keyFormat}) AS key,
                COUNT(DISTINCT d."paymentId")::int AS count,
                COALESCE(SUM(d."disputedAmount"), 0)::text AS amount
           FROM "disputes" d
           JOIN "payments" p ON p."id" = d."paymentId"
          WHERE p."merchantId" = $1
            AND d."createdAt" >= ($4::timestamptz AT TIME ZONE 'UTC')
            AND d."createdAt" < ($5::timestamptz AT TIME ZONE 'UTC')
            ${eventCurrencyFilter}
          GROUP BY 1`,
        eventParams,
      ),
    ]);

    const aggregates = new Map<string, {
      paymentCount: number;
      refundCount: number;
      refundAmount: number;
      disputeCount: number;
      disputeAmount: number;
    }>();
    for (const { key } of bucketRows) {
      aggregates.set(key, {
        paymentCount: 0,
        refundCount: 0,
        refundAmount: 0,
        disputeCount: 0,
        disputeAmount: 0,
      });
    }
    for (const row of paymentRows) aggregates.get(row.key).paymentCount = Number(row.count);
    for (const row of refundRows) {
      const agg = aggregates.get(row.key);
      agg.refundCount = Number(row.count);
      agg.refundAmount = Number(row.amount);
    }
    for (const row of disputeRows) {
      const agg = aggregates.get(row.key);
      agg.disputeCount = Number(row.count);
      agg.disputeAmount = Number(row.amount);
    }

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      interval,
      timezone,
      currency,
      buckets: bucketRows.map(({ key, start }) => {
        const agg = aggregates.get(key);
        return {
          start: new Date(start).toISOString(),
          localStart: key,
          refundCount: agg.refundCount,
          refundAmount: money(agg.refundAmount),
          refundRate: agg.paymentCount > 0 ? Number((agg.refundCount / agg.paymentCount).toFixed(4)) : null,
          disputeCount: agg.disputeCount,
          disputeAmount: money(agg.disputeAmount),
          disputeRate: agg.paymentCount > 0 ? Number((agg.disputeCount / agg.paymentCount).toFixed(4)) : null,
        };
      }),
    };
  }

  private async query(
    merchantId: string,
    from: Date,
    to: Date,
    interval: AnalyticsInterval,
    timezone: string,
    currency: string | null,
    groupBy: AnalyticsGroupBy | null,
  ): Promise<PaymentAnalyticsResult> {
    const groupExpr = GROUP_EXPRESSIONS[groupBy ?? 'none'];
    // "createdAt" columns are UTC timestamps without zone. Converting to the
    // merchant zone before date_trunc, and back afterwards, keeps buckets on
    // local midnight/hour boundaries across DST changes.
    const localBucket = (column: string) =>
      `date_trunc($2, ${column} AT TIME ZONE 'UTC' AT TIME ZONE $3)`;
    const keyFormat = `'YYYY-MM-DD"T"HH24:MI:SS'`;

    // Stepping in local wall-clock time yields 23h/25h days across DST.
    const bucketRows: { key: string; start: Date }[] = await this.dataSource.query(
      `SELECT to_char(gs, ${keyFormat}) AS key, (gs AT TIME ZONE $2) AS start
         FROM generate_series(
                date_trunc($1, $3::timestamptz AT TIME ZONE $2),
                date_trunc($1, ($4::timestamptz - interval '1 microsecond') AT TIME ZONE $2),
                ('1 ' || $1)::interval
              ) AS gs
        ORDER BY gs`,
      [interval, timezone, from, to],
    );

    const baseParams: unknown[] = [merchantId, interval, timezone, from, to];

    const paymentParams = [...baseParams, SUCCESS_STATUSES, UNSETTLED_STATUSES];
    if (currency) paymentParams.push(currency);

    const paymentRows: Array<Record<string, string>> = await this.dataSource.query(
      `SELECT to_char(${localBucket('p."createdAt"')}, ${keyFormat}) AS key,
              ${groupExpr} AS grp,
              COUNT(*) FILTER (WHERE p."status" <> ALL($7))::int AS count,
              COUNT(*) FILTER (WHERE p."status" = ANY($6))::int AS "successCount",
              COALESCE(SUM(p."amount") FILTER (WHERE p."status" = ANY($6)), 0)::text AS gross,
              COALESCE(SUM(p."feeAmount") FILTER (WHERE p."status" = ANY($6)), 0)::text AS fees
         FROM "payments" p
        WHERE p."merchantId" = $1
          AND p."createdAt" >= ($4::timestamptz AT TIME ZONE 'UTC')
          AND p."createdAt" < ($5::timestamptz AT TIME ZONE 'UTC')
          ${currency ? `AND p."currency" = $8` : ''}
        GROUP BY 1, 2`,
      paymentParams,
    );

    // Refunds are bucketed by when they happened, not when the payment was made.
    const refundRows: Array<Record<string, string>> = await this.dataSource.query(
      `SELECT to_char(${localBucket('r."createdAt"')}, ${keyFormat}) AS key,
              ${groupExpr} AS grp,
              COALESCE(SUM(r."amount"), 0)::text AS refunds
         FROM "refunds" r
         JOIN "payments" p ON p."id" = r."paymentId"
        WHERE p."merchantId" = $1
          AND r."createdAt" >= ($4::timestamptz AT TIME ZONE 'UTC')
          AND r."createdAt" < ($5::timestamptz AT TIME ZONE 'UTC')
          ${currency ? `AND p."currency" = $6` : ''}
        GROUP BY 1, 2`,
      currency ? [...baseParams, currency] : baseParams,
    );

    const aggregates = new Map<string | null, Map<string, Aggregate>>();
    const entry = (grp: string | null, key: string): Aggregate => {
      let byKey = aggregates.get(grp);
      if (!byKey) {
        byKey = new Map();
        aggregates.set(grp, byKey);
      }
      let agg = byKey.get(key);
      if (!agg) {
        agg = { gross: 0, fees: 0, refunds: 0, count: 0, successCount: 0 };
        byKey.set(key, agg);
      }
      return agg;
    };

    for (const row of paymentRows) {
      const agg = entry(row.grp ?? null, row.key);
      agg.gross += Number(row.gross);
      agg.fees += Number(row.fees);
      agg.count += Number(row.count);
      agg.successCount += Number(row.successCount);
    }
    for (const row of refundRows) {
      entry(row.grp ?? null, row.key).refunds += Number(row.refunds);
    }
    if (aggregates.size === 0 && !groupBy) {
      aggregates.set(null, new Map());
    }

    const series: AnalyticsSeries[] = [...aggregates.entries()]
      .sort(([a], [b]) => String(a).localeCompare(String(b)))
      .map(([group, byKey]) => ({
        group,
        buckets: bucketRows.map(({ key, start }) =>
          toBucket(key, start, byKey.get(key)),
        ),
      }));

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      interval,
      timezone,
      currency,
      groupBy,
      series,
    };
  }

  private async getMerchantTimezone(merchantId: string): Promise<string> {
    const settings = await this.settingsRepo.findOne({ where: { merchantId } });
    return settings?.timezone || 'UTC';
  }

  private remember(key: string, value: PaymentAnalyticsResult): void {
    const now = Date.now();
    if (this.cache.size >= CACHE_MAX_ENTRIES) {
      for (const [k, v] of this.cache) {
        if (v.expiresAt <= now) this.cache.delete(k);
      }
      // Still full: drop the oldest insertion.
      if (this.cache.size >= CACHE_MAX_ENTRIES) {
        const oldest = this.cache.keys().next().value;
        if (oldest !== undefined) this.cache.delete(oldest);
      }
    }
    this.cache.set(key, { expiresAt: now + CACHE_TTL_MS, value });
  }
}

function money(value: number): string {
  return value.toFixed(2);
}

function toBucket(key: string, start: Date, agg: Aggregate | undefined): AnalyticsBucket {
  const a = agg ?? { gross: 0, fees: 0, refunds: 0, count: 0, successCount: 0 };
  return {
    start: new Date(start).toISOString(),
    localStart: key,
    gross: money(a.gross),
    fees: money(a.fees),
    refunds: money(a.refunds),
    net: money(a.gross - a.fees - a.refunds),
    count: a.count,
    successCount: a.successCount,
    successRate: a.count > 0 ? Number((a.successCount / a.count).toFixed(4)) : null,
    averageTicket: a.successCount > 0 ? money(a.gross / a.successCount) : null,
  };
}
