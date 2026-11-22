import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { BalanceHistoryDto } from './dto/balance-history.dto';
import { MerchantSettings } from '../merchants/entities/merchant-settings.entity';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { LedgerAccount, LedgerEntry } from './ledger-entry.entity';
import {
  appendLedgerTransaction,
  LedgerTransactionInput,
} from './ledger-transaction';
import { GetLedgerEntriesDto } from './dto/get-ledger-entries.dto';
import { PaginatedResult } from '../../common/interfaces/paginated-result.interface';
import { buildCsv, EXPORT_COLUMNS } from '../exports/exports.service';

/**
 * Largest range `format=csv` builds inline. Bigger ranges must run as a
 * background job (`POST /v1/exports` with `resource: "ledger"`).
 */
export const LEDGER_CSV_SYNC_ROW_LIMIT = 5000;

export interface LedgerBalance {
  currency: string;
  account: LedgerAccount;
  balance: string;
}

export interface LedgerConsistencyReport {
  checkedAt: Date;
  unbalancedTransactions: Array<{
    transactionId: string;
    amount: string;
  }>;
}

@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);
  private readonly historyCache = new Map<string, { expires: number; rows: unknown[] }>();

  constructor(
    @InjectRepository(LedgerEntry)
    private readonly ledgerRepository: Repository<LedgerEntry>,
  ) {}

  async getHistory(merchantId: string, dto: BalanceHistoryDto) {
    const from = new Date(`${dto.from}T00:00:00Z`);
    const to = new Date(`${dto.to}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dto.from) || !/^\d{4}-\d{2}-\d{2}$/.test(dto.to) ||
        !Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) ||
        from.toISOString().slice(0, 10) !== dto.from || to.toISOString().slice(0, 10) !== dto.to ||
        to < from || to.getTime() - from.getTime() > 365 * 86400000) {
      throw new BadRequestException('Use valid from/to calendar dates spanning at most 366 days');
    }
    const settings = await this.ledgerRepository.manager.findOne(MerchantSettings, { where: { merchantId } });
    const timezone = settings?.timezone || 'UTC';
    const key = JSON.stringify([merchantId, timezone, dto.from, dto.to]);
    const cached = this.historyCache.get(key);
    if (cached && cached.expires > Date.now()) return { merchantId, timezone, days: cached.rows };
    const rows: unknown[] = await this.ledgerRepository.manager.query(`
      WITH days AS (
        SELECT generate_series($2::date::timestamp, $3::date::timestamp, interval '1 day') AS day
      ), currencies AS (
        SELECT DISTINCT currency FROM ledger_entries
        WHERE "merchantId" = $1 AND "createdAt" < (($3::date + 1)::timestamp AT TIME ZONE $4)
      )
      SELECT to_char(days.day, 'YYYY-MM-DD') AS date, currencies.currency,
             COALESCE(SUM(e.amount), 0)::text AS balance
      FROM days CROSS JOIN currencies
      LEFT JOIN ledger_entries e ON e."merchantId" = $1
        AND e.currency = currencies.currency AND e.account = 'AVAILABLE'
        AND e."createdAt" < ((days.day + interval '1 day') AT TIME ZONE $4)
      GROUP BY days.day, currencies.currency ORDER BY days.day, currencies.currency
    `, [merchantId, dto.from, dto.to, timezone]);
    // Bounded short-lived cache also covers entries written by other modules.
    for (const [cacheKey, value] of this.historyCache) if (value.expires <= Date.now()) this.historyCache.delete(cacheKey);
    if (this.historyCache.size >= 500) this.historyCache.delete(this.historyCache.keys().next().value!);
    this.historyCache.set(key, { expires: Date.now() + 60000, rows });
    return { merchantId, timezone, days: rows };
  }

  async append(input: LedgerTransactionInput): Promise<LedgerEntry[]> {
    this.historyCache.clear();
    return appendLedgerTransaction(this.ledgerRepository.manager, input);
  }

  async getBalance(
    merchantId: string,
    currency?: string,
  ): Promise<{ merchantId: string; balances: LedgerBalance[] }> {
    const query = this.ledgerRepository
      .createQueryBuilder('entry')
      .select('entry.currency', 'currency')
      .addSelect('entry.account', 'account')
      .addSelect('COALESCE(SUM(entry.amount), 0)', 'balance')
      .where('entry.merchantId = :merchantId', { merchantId })
      .groupBy('entry.currency')
      .addGroupBy('entry.account')
      .orderBy('entry.currency', 'ASC')
      .addOrderBy('entry.account', 'ASC');

    if (currency) {
      query.andWhere('entry.currency = :currency', {
        currency: currency.toUpperCase(),
      });
    }

    const rows = await query.getRawMany<{
      currency: string;
      account: LedgerAccount;
      balance: string;
    }>();

    return {
      merchantId,
      balances: rows.map((row) => ({
        currency: row.currency,
        account: row.account,
        balance: String(row.balance),
      })),
    };
  }

  async findLedger(
    merchantId: string,
    dto: GetLedgerEntriesDto,
  ): Promise<PaginatedResult<LedgerEntry>> {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const query = this.ledgerRepository
      .createQueryBuilder('entry')
      .where('entry.merchantId = :merchantId', { merchantId });
    this.applyLedgerFilters(query, dto);

    const [data, total] = await query
      .orderBy('entry.createdAt', 'DESC')
      .addOrderBy('entry.id', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return { data, total, page, limit };
  }

  /**
   * Builds the CSV for `GET /v1/merchants/me/ledger?format=csv`. Entries are
   * oldest first so the file reads like a statement. Ranges above
   * LEDGER_CSV_SYNC_ROW_LIMIT are refused and must use a background export.
   */
  async exportCsv(
    merchantId: string,
    dto: GetLedgerEntriesDto,
  ): Promise<string> {
    if (!dto.from || !dto.to) {
      throw new BadRequestException('format=csv requires both from and to');
    }
    if (new Date(dto.from).getTime() > new Date(dto.to).getTime()) {
      throw new BadRequestException('from must be earlier than or equal to to');
    }

    const query = this.ledgerRepository
      .createQueryBuilder('entry')
      .where('entry.merchantId = :merchantId', { merchantId });
    this.applyLedgerFilters(query, dto);

    const entries = await query
      .orderBy('entry.createdAt', 'ASC')
      .addOrderBy('entry.id', 'ASC')
      .take(LEDGER_CSV_SYNC_ROW_LIMIT + 1)
      .getMany();
    if (entries.length > LEDGER_CSV_SYNC_ROW_LIMIT) {
      throw new BadRequestException(
        `Range has more than ${LEDGER_CSV_SYNC_ROW_LIMIT} entries. ` +
          'Use POST /v1/exports with resource "ledger" to run it as a background job.',
      );
    }

    return buildCsv(EXPORT_COLUMNS.ledger, entries);
  }

  private applyLedgerFilters(
    query: SelectQueryBuilder<LedgerEntry>,
    dto: GetLedgerEntriesDto,
  ): void {
    if (dto.currency) {
      query.andWhere('entry.currency = :currency', {
        currency: dto.currency.toUpperCase(),
      });
    }
    if (dto.account) {
      query.andWhere('entry.account = :account', { account: dto.account });
    }
    if (dto.referenceType) {
      query.andWhere('entry.referenceType = :referenceType', {
        referenceType: dto.referenceType,
      });
    }
    if (dto.from) {
      query.andWhere('entry.createdAt >= :from', { from: new Date(dto.from) });
    }
    if (dto.to) {
      query.andWhere('entry.createdAt <= :to', { to: new Date(dto.to) });
    }
  }

  async checkConsistency(): Promise<LedgerConsistencyReport> {
    const rows = await this.ledgerRepository
      .createQueryBuilder('entry')
      .select('entry.transactionId', 'transactionId')
      .addSelect('SUM(entry.amount)', 'amount')
      .groupBy('entry.transactionId')
      .having('SUM(entry.amount) <> 0')
      .getRawMany<{ transactionId: string; amount: string }>();

    const report: LedgerConsistencyReport = {
      checkedAt: new Date(),
      unbalancedTransactions: rows.map((row) => ({
        transactionId: row.transactionId,
        amount: String(row.amount),
      })),
    };

    if (report.unbalancedTransactions.length > 0) {
      this.logger.error(
        `Ledger consistency check found ${report.unbalancedTransactions.length} unbalanced transaction(s)`,
      );
    } else {
      this.logger.debug('Ledger consistency check passed');
    }

    return report;
  }

  @Cron('0 3 * * *')
  async scheduledConsistencyCheck(): Promise<void> {
    await this.checkConsistency();
  }
}
