import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import Redis from 'ioredis';
import { GetMetricsDto } from './dto/get-metrics.dto';

@Injectable()
export class AdminMetricsService implements OnModuleDestroy {
  private readonly redisClient: Redis;

  constructor(
    @InjectDataSource() private dataSource: DataSource,
    private configService: ConfigService,
  ) {
    this.redisClient = new Redis({
      host: this.configService.get('REDIS_HOST', 'localhost'),
      port: this.configService.get('REDIS_PORT', 6379),
    });
  }

  async getMetrics(query: GetMetricsDto) {
    // Default to last 30 days if not provided
    const defaultFrom = new Date();
    defaultFrom.setMonth(defaultFrom.getMonth() - 1);
    
    const from = query.from || defaultFrom.toISOString();
    const to = query.to || new Date().toISOString();
    const interval = query.interval || 'day';

    const cacheKey = `admin_metrics:${from}:${to}:${interval}`;
    const cached = await this.redisClient.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }
    
    const [
      volumeRows,
      statusRows,
      merchantRows,
      signupRows,
      refundRows,
      disputeRows,
      feeRows
    ] = await Promise.all([
      this.dataSource.query(
        `SELECT currency, SUM(amount) as volume FROM payments WHERE "createdAt" >= $1 AND "createdAt" <= $2 AND status = 'COMPLETED' GROUP BY currency`,
        [from, to]
      ),
      this.dataSource.query(
        `SELECT status, COUNT(*) as count FROM payments WHERE "createdAt" >= $1 AND "createdAt" <= $2 GROUP BY status`,
        [from, to]
      ),
      this.dataSource.query(
        `SELECT COUNT(*) as active_merchants FROM users WHERE 'MERCHANT' = ANY(roles) AND status = 'ACTIVE'`
      ),
      this.dataSource.query(
        `SELECT COUNT(*) as new_signups FROM users WHERE "createdAt" >= $1 AND "createdAt" <= $2`,
        [from, to]
      ),
      this.dataSource.query(
        `SELECT SUM(amount) as refund_total FROM refunds WHERE "createdAt" >= $1 AND "createdAt" <= $2`,
        [from, to]
      ),
      this.dataSource.query(
        `SELECT SUM("disputedAmount") as dispute_total FROM disputes WHERE "createdAt" >= $1 AND "createdAt" <= $2`,
        [from, to]
      ),
      this.dataSource.query(
        `SELECT SUM("feeAmount") as fees_collected FROM payments WHERE "createdAt" >= $1 AND "createdAt" <= $2 AND status = 'COMPLETED'`,
        [from, to]
      ),
    ]);

    const metrics = {
      volumeByCurrency: volumeRows.map((r: any) => ({ currency: r.currency, volume: Number(r.volume) })),
      paymentCountByStatus: statusRows.map((r: any) => ({ status: r.status, count: Number(r.count) })),
      activeMerchants: Number(merchantRows[0]?.active_merchants || 0),
      newSignups: Number(signupRows[0]?.new_signups || 0),
      refundTotal: Number(refundRows[0]?.refund_total || 0),
      disputeTotal: Number(disputeRows[0]?.dispute_total || 0),
      feesCollected: Number(feeRows[0]?.fees_collected || 0),
    };

    // Cache for 5 minutes (300 seconds)
    await this.redisClient.set(cacheKey, JSON.stringify(metrics), 'EX', 300);

    return metrics;
  }

  onModuleDestroy() {
    this.redisClient.disconnect();
  }
}
