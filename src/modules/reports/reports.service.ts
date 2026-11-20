import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Logger } from 'pino';
import { AppLogger } from '../logger/logger.service';
import {
  ReportSubscription,
  ReportFrequency,
} from './entities/report-subscription.entity';
import { CreateReportSubscriptionDto } from './dto/create-report-subscription.dto';
import { UpdateReportSubscriptionDto } from './dto/update-report-subscription.dto';
import { Payment, PaymentStatus } from '../payments/payment.entity';
import { Refund } from '../payments/refund.entity';
import { EmailNotificationService } from '../notifications/email-notification.service';
import { csvEscape } from '../settlements/settlement-statement-export';

export interface ReportSummary {
  periodStart: Date;
  periodEnd: Date;
  frequency: ReportFrequency;
  totalPayments: number;
  completedPayments: number;
  totalVolume: number;
  totalFees: number;
  totalNetAmount: number;
  totalRefunds: number;
  refundCount: number;
  currency: string;
}

@Injectable()
export class ReportsService {
  private readonly logger: Logger;

  constructor(
    @InjectRepository(ReportSubscription)
    private readonly subscriptionRepo: Repository<ReportSubscription>,
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(Refund)
    private readonly refundRepo: Repository<Refund>,
    private readonly emailNotificationService: EmailNotificationService,
    appLogger: AppLogger,
  ) {
    this.logger = appLogger.child({ module: ReportsService.name });
  }

  // ─── CRUD ────────────────────────────────────────────────────────────────

  async create(
    merchantId: string,
    dto: CreateReportSubscriptionDto,
  ): Promise<ReportSubscription> {
    const subscription = this.subscriptionRepo.create({
      merchantId,
      frequency: dto.frequency,
      recipients: dto.recipients,
      timezone: dto.timezone ?? 'UTC',
      includeCsv: dto.includeCsv ?? false,
      isActive: true,
      lastSentAt: null,
    });
    return this.subscriptionRepo.save(subscription);
  }

  async findAllForMerchant(merchantId: string): Promise<ReportSubscription[]> {
    return this.subscriptionRepo.find({
      where: { merchantId },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string, merchantId: string): Promise<ReportSubscription> {
    const sub = await this.subscriptionRepo.findOne({ where: { id } });
    if (!sub) throw new NotFoundException('Report subscription not found');
    if (sub.merchantId !== merchantId) throw new ForbiddenException();
    return sub;
  }

  async update(
    id: string,
    merchantId: string,
    dto: UpdateReportSubscriptionDto,
  ): Promise<ReportSubscription> {
    const sub = await this.findOne(id, merchantId);
    Object.assign(sub, dto);
    return this.subscriptionRepo.save(sub);
  }

  async remove(id: string, merchantId: string): Promise<void> {
    const sub = await this.findOne(id, merchantId);
    await this.subscriptionRepo.remove(sub);
  }

  // ─── Unsubscribe (public, token-less — matches existing unsubscribe UX) ──

  async unsubscribeByEmail(subscriptionId: string, email: string): Promise<void> {
    const sub = await this.subscriptionRepo.findOne({
      where: { id: subscriptionId },
    });
    if (!sub) return; // silently succeed
    sub.recipients = sub.recipients.filter((r) => r !== email);
    if (sub.recipients.length === 0) {
      sub.isActive = false;
    }
    await this.subscriptionRepo.save(sub);
  }

  // ─── Summary builder ─────────────────────────────────────────────────────

  async buildSummary(
    merchantId: string,
    frequency: ReportFrequency,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<ReportSummary> {
    const payments = await this.paymentRepo.find({
      where: {
        merchantId,
        createdAt: Between(periodStart, periodEnd),
      },
    });

    const completed = payments.filter(
      (p) =>
        p.status === PaymentStatus.COMPLETED ||
        p.status === PaymentStatus.PARTIALLY_COMPLETED,
    );

    const totalVolume = completed.reduce(
      (s, p) => s + Number(p.amount ?? 0),
      0,
    );
    const totalFees = completed.reduce(
      (s, p) => s + Number(p.feeAmount ?? 0),
      0,
    );
    const totalNetAmount = completed.reduce(
      (s, p) => s + Number(p.netAmount ?? 0),
      0,
    );

    const refunds = await this.refundRepo.find({
      where: {
        payment: { merchantId },
        createdAt: Between(periodStart, periodEnd),
      },
      relations: ['payment'],
    });

    const totalRefunds = refunds.reduce(
      (s, r) => s + Number(r.amount ?? 0),
      0,
    );

    // Derive dominant currency (first completed payment's currency, or USD)
    const currency = completed[0]?.currency ?? payments[0]?.currency ?? 'USD';

    return {
      periodStart,
      periodEnd,
      frequency,
      totalPayments: payments.length,
      completedPayments: completed.length,
      totalVolume: +totalVolume.toFixed(2),
      totalFees: +totalFees.toFixed(2),
      totalNetAmount: +totalNetAmount.toFixed(2),
      totalRefunds: +totalRefunds.toFixed(2),
      refundCount: refunds.length,
      currency,
    };
  }

  // ─── CSV builder ─────────────────────────────────────────────────────────

  buildCsv(merchantId: string, payments: Payment[]): string {
    const header =
      'ID,Amount,Currency,Status,ExternalRef,Description,FeeAmount,NetAmount,RefundedAmount,CreatedAt\n';
    const rows = payments.map((p) =>
      [
        p.id,
        p.amount,
        p.currency,
        p.status,
        p.externalReference,
        p.description,
        p.feeAmount,
        p.netAmount,
        p.refundedAmount,
        p.createdAt instanceof Date ? p.createdAt.toISOString() : p.createdAt,
      ]
        .map(csvEscape)
        .join(','),
    );
    return header + rows.join('\n');
  }

  // ─── Period helpers ───────────────────────────────────────────────────────

  /**
   * Returns the [start, end) window that just completed for the given frequency
   * relative to `now` in the subscription's timezone.
   */
  getPeriodBounds(
    frequency: ReportFrequency,
    timezone: string,
    now: Date = new Date(),
  ): { start: Date; end: Date } {
    // We derive a "midnight today" in the merchant's timezone by formatting and
    // re-parsing, avoiding a full tz library dependency.
    const localMidnight = this.localMidnight(now, timezone);

    if (frequency === ReportFrequency.DAILY) {
      const start = new Date(localMidnight);
      start.setUTCDate(start.getUTCDate() - 1);
      return { start, end: localMidnight };
    }

    if (frequency === ReportFrequency.WEEKLY) {
      const end = new Date(localMidnight);
      const start = new Date(localMidnight);
      start.setUTCDate(start.getUTCDate() - 7);
      return { start, end };
    }

    // MONTHLY
    const end = new Date(localMidnight);
    const start = new Date(localMidnight);
    start.setUTCMonth(start.getUTCMonth() - 1);
    return { start, end };
  }

  /**
   * Returns true if a subscription is due to be sent at `now`.
   * A subscription is due when:
   *  - it's active
   *  - it has never been sent, or the last send was before the current period start
   */
  isDue(sub: ReportSubscription, now: Date = new Date()): boolean {
    if (!sub.isActive) return false;
    const { start } = this.getPeriodBounds(sub.frequency, sub.timezone, now);
    return sub.lastSentAt === null || sub.lastSentAt < start;
  }

  // ─── Cron ─────────────────────────────────────────────────────────────────

  /** Runs every hour; dispatches due reports */
  @Cron(CronExpression.EVERY_HOUR)
  async dispatchDueReports(): Promise<void> {
    const active = await this.subscriptionRepo.find({
      where: { isActive: true },
    });

    const now = new Date();
    const due = active.filter((s) => this.isDue(s, now));

    this.logger.info(
      { total: active.length, due: due.length },
      'Checking report subscriptions',
    );

    for (const sub of due) {
      try {
        await this.dispatchReport(sub, now);
      } catch (err: any) {
        this.logger.error(
          { subscriptionId: sub.id, error: err?.message },
          'Failed to dispatch report',
        );
      }
    }
  }

  async dispatchReport(sub: ReportSubscription, now: Date = new Date()): Promise<void> {
    const { start, end } = this.getPeriodBounds(sub.frequency, sub.timezone, now);
    const summary = await this.buildSummary(sub.merchantId, sub.frequency, start, end);

    let csvAttachment: string | undefined;
    if (sub.includeCsv) {
      const payments = await this.paymentRepo.find({
        where: {
          merchantId: sub.merchantId,
          createdAt: Between(start, end),
        },
      });
      csvAttachment = this.buildCsv(sub.merchantId, payments);
    }

    for (const recipient of sub.recipients) {
      await this.emailNotificationService.sendMerchantReport(
        recipient,
        summary,
        sub.id,
        csvAttachment,
      );
    }

    sub.lastSentAt = now;
    await this.subscriptionRepo.save(sub);

    this.logger.info(
      { subscriptionId: sub.id, recipients: sub.recipients.length },
      'Report dispatched',
    );
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  /**
   * Returns a UTC Date representing 00:00:00 of `date` in `timezone`.
   * Uses Intl.DateTimeFormat for IANA timezone support without extra deps.
   */
  private localMidnight(date: Date, timezone: string): Date {
    try {
      const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      const parts = formatter.formatToParts(date);
      const y = parts.find((p) => p.type === 'year')!.value;
      const m = parts.find((p) => p.type === 'month')!.value;
      const d = parts.find((p) => p.type === 'day')!.value;
      return new Date(`${y}-${m}-${d}T00:00:00.000Z`);
    } catch {
      // Fallback to UTC midnight if timezone is invalid
      const d = new Date(date);
      d.setUTCHours(0, 0, 0, 0);
      return d;
    }
  }
}
