import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Payment, PaymentStatus } from './payment.entity';
import { GetPaymentsDto } from './dto/get-payments.dto';

export type ExportFormat = 'csv' | 'pdf';

const CSV_HEADERS = [
  'id',
  'amount',
  'currency',
  'status',
  'description',
  'externalReference',
  'refundedAmount',
  'createdAt',
  'updatedAt',
];

function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildCsv(payments: Payment[]): string {
  const lines: string[] = [CSV_HEADERS.join(',')];
  for (const p of payments) {
    lines.push(
      CSV_HEADERS.map((h) => escapeCsvField(p[h as keyof Payment])).join(','),
    );
  }
  return lines.join('\r\n');
}

function buildPdf(payments: Payment[]): Buffer {
  const lines: string[] = [];
  lines.push('FacilPay - Payment Export Report');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Total records: ${payments.length}`);
  lines.push('');
  lines.push(CSV_HEADERS.join(' | '));
  lines.push('-'.repeat(120));

  for (const p of payments) {
    lines.push(
      CSV_HEADERS.map((h) => {
        const v = p[h as keyof Payment];
        return v === null || v === undefined ? '' : String(v);
      }).join(' | '),
    );
  }

  const statusTotals: Partial<Record<PaymentStatus, number>> = {};
  for (const p of payments) {
    statusTotals[p.status] = (statusTotals[p.status] ?? 0) + 1;
  }
  lines.push('');
  lines.push('Summary by Status:');
  for (const [status, count] of Object.entries(statusTotals)) {
    lines.push(`  ${status}: ${count}`);
  }

  return Buffer.from(lines.join('\n'), 'utf-8');
}

@Injectable()
export class ExportService {
  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
  ) {}

  async exportPayments(
    format: ExportFormat,
    filters: GetPaymentsDto,
  ): Promise<{ data: Buffer | string; contentType: string; filename: string }> {
    if (format !== 'csv' && format !== 'pdf') {
      throw new BadRequestException(
        `Unsupported export format '${format}'. Use 'csv' or 'pdf'.`,
      );
    }

    const qb = this.paymentRepository
      .createQueryBuilder('payment')
      .orderBy('payment.createdAt', 'DESC');

    if (filters.status) {
      qb.andWhere('payment.status = :status', { status: filters.status });
    }
    if (filters.currency) {
      qb.andWhere('payment.currency = :currency', { currency: filters.currency });
    }
    if (filters.from) {
      qb.andWhere('payment.createdAt >= :from', { from: filters.from });
    }
    if (filters.to) {
      qb.andWhere('payment.createdAt <= :to', { to: filters.to });
    }
    if (filters.minAmount !== undefined) {
      qb.andWhere('payment.amount >= :min', { min: filters.minAmount });
    }
    if (filters.maxAmount !== undefined) {
      qb.andWhere('payment.amount <= :max', { max: filters.maxAmount });
    }
    if (filters.search) {
      qb.andWhere(
        '(payment.description ILIKE :s OR payment.externalReference ILIKE :s)',
        { s: `%${filters.search}%` },
      );
    }

    const payments = await qb.getMany();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    if (format === 'csv') {
      return {
        data: buildCsv(payments),
        contentType: 'text/csv',
        filename: `payments-${timestamp}.csv`,
      };
    }

    return {
      data: buildPdf(payments),
      contentType: 'application/pdf',
      filename: `payments-${timestamp}.pdf`,
    };
  }
}
