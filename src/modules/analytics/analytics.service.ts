import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Payment, PaymentStatus } from '../payments/payment.entity';
import { AppLogger } from '../logger/logger.service';
import { Logger } from 'pino';
import { AnalyticsCacheService } from './analytics-cache.service';
import { AnalyticsPeriod } from './dto/analytics-query.dto';
import {
  PaymentMetricsDto,
  CurrencyBreakdownDto,
  StatusBreakdownDto,
  StatusBreakdownItemDto,
} from './dto/analytics-response.dto';

const CACHE_TTL_SECONDS = 60;

@Injectable()
export class AnalyticsService {
  private readonly logger: Logger;

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    private readonly cacheService: AnalyticsCacheService,
    appLogger: AppLogger,
  ) {
    this.logger = appLogger.child({ module: AnalyticsService.name });
  }

  /**
   * Compute the [start, end] date range for the requested period relative to now.
   */
  private getPeriodRange(period: AnalyticsPeriod): { start: Date; end: Date } {
    const now = new Date();
    const end = new Date(now);
    let start: Date;

    switch (period) {
      case AnalyticsPeriod.DAY:
        start = new Date(now);
        start.setUTCHours(0, 0, 0, 0);
        end.setUTCHours(23, 59, 59, 999);
        break;
      case AnalyticsPeriod.WEEK: {
        start = new Date(now);
        const day = start.getUTCDay(); // 0 = Sunday
        start.setUTCDate(start.getUTCDate() - day);
        start.setUTCHours(0, 0, 0, 0);
        end.setUTCHours(23, 59, 59, 999);
        break;
      }
      case AnalyticsPeriod.MONTH:
        start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
        end.setUTCHours(23, 59, 59, 999);
        break;
      case AnalyticsPeriod.YEAR:
        start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
        end.setUTCHours(23, 59, 59, 999);
        break;
      default:
        start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
        end.setUTCHours(23, 59, 59, 999);
    }

    return { start, end };
  }

  /**
   * GET /v1/analytics/payments
   * Total volume, count, and average amount for the requesting merchant.
   */
  async getPaymentMetrics(
    userId: string,
    period: AnalyticsPeriod,
  ): Promise<PaymentMetricsDto> {
    const cacheKey = `analytics:metrics:${userId}:${period}`;
    const cached = await this.cacheService.get<PaymentMetricsDto>(cacheKey);
    if (cached) {
      this.logger.debug({ cacheKey }, 'Analytics metrics cache hit');
      return cached;
    }

    const { start, end } = this.getPeriodRange(period);

    const result = await this.paymentRepository
      .createQueryBuilder('payment')
      .select('COALESCE(SUM(payment.amount::numeric), 0)', 'totalVolume')
      .addSelect('COUNT(payment.id)', 'totalCount')
      .addSelect('COALESCE(AVG(payment.amount::numeric), 0)', 'averageAmount')
      .where('payment.userId = :userId', { userId })
      .andWhere('payment.createdAt >= :start', { start })
      .andWhere('payment.createdAt <= :end', { end })
      .getRawOne<{ totalVolume: string; totalCount: string; averageAmount: string }>();

    const metrics: PaymentMetricsDto = {
      totalVolume: parseFloat(result?.totalVolume ?? '0'),
      totalCount: parseInt(result?.totalCount ?? '0', 10),
      averageAmount: parseFloat(result?.averageAmount ?? '0'),
      period,
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
    };

    await this.cacheService.set(cacheKey, metrics, CACHE_TTL_SECONDS);
    this.logger.debug({ userId, period }, 'Analytics metrics computed and cached');

    return metrics;
  }

  /**
   * GET /v1/analytics/payments/by-currency
   * Payment volume and count grouped by currency for the requesting merchant.
   */
  async getPaymentsByCurrency(
    userId: string,
    period: AnalyticsPeriod,
  ): Promise<CurrencyBreakdownDto> {
    const cacheKey = `analytics:by-currency:${userId}:${period}`;
    const cached = await this.cacheService.get<CurrencyBreakdownDto>(cacheKey);
    if (cached) {
      this.logger.debug({ cacheKey }, 'Analytics by-currency cache hit');
      return cached;
    }

    const { start, end } = this.getPeriodRange(period);

    const rows = await this.paymentRepository
      .createQueryBuilder('payment')
      .select('payment.currency', 'currency')
      .addSelect('COALESCE(SUM(payment.amount::numeric), 0)', 'totalVolume')
      .addSelect('COUNT(payment.id)', 'count')
      .addSelect('COALESCE(AVG(payment.amount::numeric), 0)', 'averageAmount')
      .where('payment.userId = :userId', { userId })
      .andWhere('payment.createdAt >= :start', { start })
      .andWhere('payment.createdAt <= :end', { end })
      .groupBy('payment.currency')
      .orderBy('"totalVolume"', 'DESC')
      .getRawMany<{
        currency: string;
        totalVolume: string;
        count: string;
        averageAmount: string;
      }>();

    const result: CurrencyBreakdownDto = {
      breakdown: rows.map((row) => ({
        currency: row.currency,
        totalVolume: parseFloat(row.totalVolume),
        count: parseInt(row.count, 10),
        averageAmount: parseFloat(row.averageAmount),
      })),
      period,
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
    };

    await this.cacheService.set(cacheKey, result, CACHE_TTL_SECONDS);
    this.logger.debug({ userId, period }, 'Analytics by-currency computed and cached');

    return result;
  }

  /**
   * GET /v1/analytics/payments/by-status
   * Payment breakdown by status with success/failure rates for the requesting merchant.
   */
  async getPaymentsByStatus(
    userId: string,
    period: AnalyticsPeriod,
  ): Promise<StatusBreakdownDto> {
    const cacheKey = `analytics:by-status:${userId}:${period}`;
    const cached = await this.cacheService.get<StatusBreakdownDto>(cacheKey);
    if (cached) {
      this.logger.debug({ cacheKey }, 'Analytics by-status cache hit');
      return cached;
    }

    const { start, end } = this.getPeriodRange(period);

    const rows = await this.paymentRepository
      .createQueryBuilder('payment')
      .select('payment.status', 'status')
      .addSelect('COUNT(payment.id)', 'count')
      .addSelect('COALESCE(SUM(payment.amount::numeric), 0)', 'totalVolume')
      .where('payment.userId = :userId', { userId })
      .andWhere('payment.createdAt >= :start', { start })
      .andWhere('payment.createdAt <= :end', { end })
      .groupBy('payment.status')
      .getRawMany<{ status: string; count: string; totalVolume: string }>();

    const totalCount = rows.reduce((sum, r) => sum + parseInt(r.count, 10), 0);

    const breakdown: StatusBreakdownItemDto[] = rows.map((row) => {
      const count = parseInt(row.count, 10);
      return {
        status: row.status,
        count,
        percentage:
          totalCount > 0
            ? parseFloat(((count / totalCount) * 100).toFixed(2))
            : 0,
        totalVolume: parseFloat(row.totalVolume),
      };
    });

    // Sort by count descending for readability
    breakdown.sort((a, b) => b.count - a.count);

    const completedRow = rows.find((r) => r.status === PaymentStatus.COMPLETED);
    const failedRow = rows.find((r) => r.status === PaymentStatus.FAILED);

    const completedCount = completedRow ? parseInt(completedRow.count, 10) : 0;
    const failedCount = failedRow ? parseInt(failedRow.count, 10) : 0;

    const successRate =
      totalCount > 0
        ? parseFloat(((completedCount / totalCount) * 100).toFixed(2))
        : 0;
    const failureRate =
      totalCount > 0
        ? parseFloat(((failedCount / totalCount) * 100).toFixed(2))
        : 0;

    const result: StatusBreakdownDto = {
      breakdown,
      successRate,
      failureRate,
      period,
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
    };

    await this.cacheService.set(cacheKey, result, CACHE_TTL_SECONDS);
    this.logger.debug({ userId, period }, 'Analytics by-status computed and cached');

    return result;
  }
}
