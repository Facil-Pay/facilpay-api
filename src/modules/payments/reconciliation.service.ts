import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Payment, PaymentStatus } from './payment.entity';
import { Refund } from './refund.entity';
import { ReconciliationQueryDto } from './dto/reconciliation-query.dto';

export interface StatusBreakdown {
  status: PaymentStatus;
  count: number;
  totalAmount: number;
}

export interface ReconciliationReport {
  period: { from: string | null; to: string | null };
  currency: string | null;
  generatedAt: string;
  summary: {
    totalPayments: number;
    totalAmount: number;
    totalRefundedAmount: number;
    netAmount: number;
  };
  byStatus: StatusBreakdown[];
  refunds: {
    count: number;
    totalAmount: number;
  };
}

@Injectable()
export class ReconciliationService {
  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    @InjectRepository(Refund)
    private readonly refundRepository: Repository<Refund>,
  ) {}

  async generate(query: ReconciliationQueryDto): Promise<ReconciliationReport> {
    const qb = this.paymentRepository
      .createQueryBuilder('payment')
      .select('payment.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .addSelect('COALESCE(SUM(payment.amount), 0)', 'totalAmount')
      .groupBy('payment.status');

    if (query.from) {
      qb.andWhere('payment.createdAt >= :from', { from: query.from });
    }
    if (query.to) {
      qb.andWhere('payment.createdAt <= :to', { to: query.to });
    }
    if (query.currency) {
      qb.andWhere('payment.currency = :currency', { currency: query.currency });
    }

    const rows: { status: PaymentStatus; count: string; totalAmount: string }[] =
      await qb.getRawMany();

    const byStatus: StatusBreakdown[] = rows.map((r) => ({
      status: r.status,
      count: parseInt(r.count, 10),
      totalAmount: parseFloat(r.totalAmount),
    }));

    const totalPayments = byStatus.reduce((s, r) => s + r.count, 0);
    const totalAmount = byStatus.reduce((s, r) => s + r.totalAmount, 0);

    const refundQb = this.refundRepository
      .createQueryBuilder('refund')
      .select('COUNT(*)', 'count')
      .addSelect('COALESCE(SUM(refund.amount), 0)', 'totalAmount')
      .innerJoin('payments', 'p', 'p.id = refund."paymentId"');

    if (query.from) {
      refundQb.andWhere('refund."createdAt" >= :from', { from: query.from });
    }
    if (query.to) {
      refundQb.andWhere('refund."createdAt" <= :to', { to: query.to });
    }
    if (query.currency) {
      refundQb.andWhere('p.currency = :currency', { currency: query.currency });
    }

    const refundRow: { count: string; totalAmount: string } =
      await refundQb.getRawOne();

    const refundCount = parseInt(refundRow?.count ?? '0', 10);
    const totalRefundedAmount = parseFloat(refundRow?.totalAmount ?? '0');

    return {
      period: { from: query.from ?? null, to: query.to ?? null },
      currency: query.currency ?? null,
      generatedAt: new Date().toISOString(),
      summary: {
        totalPayments,
        totalAmount: parseFloat(totalAmount.toFixed(2)),
        totalRefundedAmount: parseFloat(totalRefundedAmount.toFixed(2)),
        netAmount: parseFloat((totalAmount - totalRefundedAmount).toFixed(2)),
      },
      byStatus,
      refunds: {
        count: refundCount,
        totalAmount: parseFloat(totalRefundedAmount.toFixed(2)),
      },
    };
  }
}
