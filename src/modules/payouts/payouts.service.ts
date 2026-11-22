import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { parsePayoutCsv } from './payout-csv.util';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  ACTIVE_PAYOUT_STATUSES,
  Payout,
  PayoutStatus,
} from './entities/payout.entity';
import { MerchantPayoutLimit } from './entities/merchant-payout-limit.entity';
import { CreatePayoutDto } from './dto/create-payout.dto';
import { ListPayoutsDto } from './dto/list-payouts.dto';
import { AuthService } from '../auth/auth.service';
import { StellarService } from '../stellar/stellar.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { EventsService } from '../events/events.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { PaymentStatus } from '../payments/payment.entity';
import { SettlementStatus } from '../settlements/entities/settlement.entity';
import { PaginatedResult } from '../../common/interfaces/paginated-result.interface';
import { fromUnits, toUnits } from './payout-amount.util';
import { UsersService } from '../users/users.service';

export const PAYOUTS_QUEUE = 'payouts';

export interface PayoutBalance {
  currency: string;
  available: string;
  credited: string;
  settled: string;
  paidOut: string;
}

/** Payment statuses whose net amount has been credited to the merchant. */
const CREDITED_PAYMENT_STATUSES = [
  PaymentStatus.COMPLETED,
  PaymentStatus.PARTIALLY_REFUNDED,
  PaymentStatus.REFUNDED,
];

@Injectable()
export class PayoutsService {
  private readonly logger = new Logger(PayoutsService.name);
  private readonly defaultDailyLimit: string;

  constructor(
    @InjectRepository(Payout)
    private readonly payoutRepo: Repository<Payout>,
    @InjectRepository(MerchantPayoutLimit)
    private readonly limitRepo: Repository<MerchantPayoutLimit>,
    @InjectQueue(PAYOUTS_QUEUE)
    private readonly payoutsQueue: Queue,
    private readonly dataSource: DataSource,
    private readonly authService: AuthService,
    private readonly stellarService: StellarService,
    private readonly webhooksService: WebhooksService,
    private readonly eventsService: EventsService,
    private readonly auditLogsService: AuditLogsService,
    private readonly usersService: UsersService,
    configService: ConfigService,
  ) {
    this.defaultDailyLimit = String(
      configService.get<string | number>('PAYOUT_DAILY_LIMIT', '10000'),
    );
  }

  async create(
    merchantId: string,
    dto: CreatePayoutDto,
    stepUpToken: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<Payout> {
    this.authService.validateStepUpToken(stepUpToken, merchantId);
    await this.usersService.assertMerchantActive(merchantId);

    const currency = dto.currency.toUpperCase();
    const amountUnits = toUnits(dto.amount);
    const memo = dto.memo?.trim() || null;

    if (Buffer.byteLength(memo ?? '', 'utf8') > 28) {
      throw new BadRequestException('memo must be at most 28 bytes');
    }

    // Network checks happen before taking the lock so a slow Horizon call
    // never holds up other payouts for this merchant.
    await this.stellarService.validatePayoutRecipient(dto.destination, currency, memo);

    const payout = await this.dataSource.transaction(async (manager) => {
      // Serialise payout creation per merchant+currency so two concurrent
      // requests cannot both spend the same balance.
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `payout:${merchantId}:${currency}`,
      ]);

      const existing = await manager.findOne(Payout, {
        where: { merchantId, reference: dto.reference },
      });
      if (existing) {
        throw new ConflictException(
          `A payout with reference "${dto.reference}" already exists`,
        );
      }

      const balance = await this.computeBalance(manager, merchantId, currency);
      if (amountUnits > toUnits(balance.available)) {
        throw new BadRequestException(
          `Insufficient available balance: ${balance.available} ${currency} available`,
        );
      }

      const dailyLimit = await this.getDailyLimit(manager, merchantId, currency);
      const usedToday = await this.sumPayoutsSince(
        manager,
        merchantId,
        currency,
        startOfUtcDay(new Date()),
      );
      if (usedToday + amountUnits > toUnits(dailyLimit)) {
        throw new BadRequestException(
          `Daily payout limit of ${dailyLimit} ${currency} would be exceeded`,
        );
      }

      return manager.save(
        manager.create(Payout, {
          merchantId,
          destination: dto.destination,
          amount: fromUnits(amountUnits),
          currency,
          memo,
          reference: dto.reference,
          status: PayoutStatus.PENDING,
        }),
      );
    });

    await this.payoutsQueue.add(
      'process',
      { payoutId: payout.id },
      {
        jobId: payout.id,
        // Never retry automatically: a retried submission could pay twice.
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    await this.auditLogsService
      .record({
        actorId: merchantId,
        actorType: 'user',
        action: 'payout.created',
        resourceType: 'payout',
        resourceId: payout.id,
        ipAddress,
        userAgent,
        metadata: {
          destination: payout.destination,
          amount: payout.amount,
          currency: payout.currency,
        },
      })
      .catch((error) => this.logger.error('Failed to record payout audit log', error));

    await this.dispatchEvent(payout, 'payout.created');
    return payout;
  }

  async cancel(merchantId: string, id: string): Promise<Payout> {
    const payout = await this.dataSource.transaction(async manager => {
      const row = await manager.findOne(Payout, {
        where: { id, merchantId }, lock: { mode: 'pessimistic_write' },
      });
      if (!row) throw new NotFoundException('Payout not found');
      if (row.status === PayoutStatus.CANCELLED) return row;
      if (row.status !== PayoutStatus.PENDING) {
        throw new ConflictException('Only pending payouts can be cancelled');
      }
      row.status = PayoutStatus.CANCELLED;
      return manager.save(row);
    });
    // An already active job cannot be removed. Its conditional claim below
    // observes CANCELLED and skips submission, even if queue cleanup fails.
    try {
      const job = await this.payoutsQueue.getJob(id);
      if (job) await job.remove();
    } catch (error) {
      this.logger.warn(`Could not remove cancelled payout job ${id}: ${String(error)}`);
    }
    await this.dispatchEvent(payout, 'payout.cancelled');
    return payout;
  }

  async createBulk(merchantId: string, csv: string, stepUpToken: string) {
    this.authService.validateStepUpToken(stepUpToken, merchantId);
    await this.usersService.assertMerchantActive(merchantId);
    const rows = parsePayoutCsv(csv);
    if (new Set(rows.map(row => row.reference)).size !== rows.length) {
      throw new BadRequestException('Duplicate references in CSV');
    }
    for (const row of rows) {
      await this.stellarService.validatePayoutRecipient(row.destination, row.currency, row.memo?.trim() || null);
    }
    const batchId = randomUUID();
    const payouts = await this.dataSource.transaction(async manager => {
      const totals = new Map<string, bigint>();
      for (const row of rows) totals.set(row.currency, (totals.get(row.currency) ?? 0n) + toUnits(row.amount));
      // Stable lock order prevents deadlocks between multi-currency batches.
      for (const currency of [...totals.keys()].sort()) {
        await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`payout:${merchantId}:${currency}`]);
        const balance = await this.computeBalance(manager, merchantId, currency);
        const limit = await this.getDailyLimit(manager, merchantId, currency);
        const used = await this.sumPayoutsSince(manager, merchantId, currency, startOfUtcDay(new Date()));
        const amount = totals.get(currency)!;
        if (amount > toUnits(balance.available) || used + amount > toUnits(limit)) {
          throw new BadRequestException(`Batch exceeds available balance or daily limit for ${currency}`);
        }
      }
      for (const row of rows) {
        if (await manager.findOne(Payout, { where: { merchantId, reference: row.reference } })) {
          throw new ConflictException(`Reference ${row.reference} already exists`);
        }
      }
      return manager.save(rows.map(row => manager.create(Payout, {
        ...row, merchantId, batchId, amount: fromUnits(toUnits(row.amount)),
        memo: row.memo?.trim() || null, status: PayoutStatus.PENDING,
      })));
    });
    await this.payoutsQueue.addBulk(payouts.map(payout => ({
      name: 'process', data: { payoutId: payout.id },
      opts: { jobId: payout.id, attempts: 1, removeOnComplete: true, removeOnFail: false },
    })));
    for (const payout of payouts) await this.dispatchEvent(payout, 'payout.created');
    return { batchId, rows: payouts.map((payout, i) => ({ row: i + 2, payoutId: payout.id, reference: payout.reference, status: payout.status })) };
  }

  async findAll(
    merchantId: string,
    dto: ListPayoutsDto,
  ): Promise<PaginatedResult<Payout>> {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const [data, total] = await this.payoutRepo.findAndCount({
      where: {
        merchantId,
        ...(dto.status ? { status: dto.status } : {}),
        ...(dto.currency ? { currency: dto.currency } : {}),
      },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data, total, page, limit };
  }

  async findOne(merchantId: string, id: string): Promise<Payout> {
    const payout = await this.payoutRepo.findOne({ where: { id, merchantId } });
    if (!payout) throw new NotFoundException('Payout not found');
    return payout;
  }

  async getBalance(merchantId: string, currency: string): Promise<PayoutBalance> {
    return this.computeBalance(this.dataSource.manager, merchantId, currency.toUpperCase());
  }

  async setDailyLimit(
    merchantId: string,
    currency: string,
    dailyLimit: string | null,
  ): Promise<{ merchantId: string; currency: string; dailyLimit: string }> {
    const code = currency.toUpperCase();
    if (dailyLimit === null) {
      await this.limitRepo.delete({ merchantId, currency: code });
      return { merchantId, currency: code, dailyLimit: this.defaultDailyLimit };
    }

    const normalized = fromUnits(toUnits(dailyLimit));
    await this.limitRepo.upsert(
      { merchantId, currency: code, dailyLimit: normalized },
      ['merchantId', 'currency'],
    );
    return { merchantId, currency: code, dailyLimit: normalized };
  }

  /**
   * Moves a PENDING payout to SUBMITTED and sends it on-chain. Called by the
   * queue worker. Any failure marks the payout FAILED, which releases its
   * amount back to the available balance.
   */
  async process(payoutId: string): Promise<Payout | null> {
    const claimed = await this.payoutRepo.update(
      { id: payoutId, status: PayoutStatus.PENDING },
      { status: PayoutStatus.SUBMITTED, submittedAt: new Date() },
    );
    if (!claimed.affected) {
      this.logger.warn(`Payout ${payoutId} is not pending; skipping`);
      return null;
    }

    let payout = await this.payoutRepo.findOneByOrFail({ id: payoutId });
    await this.dispatchEvent(payout, 'payout.submitted');

    try {
      await this.usersService.assertMerchantActive(payout.merchantId);
      const result: any = await this.stellarService.sendPayout({
        destination: payout.destination,
        amount: payout.amount,
        assetCode: payout.currency,
        memo: payout.memo,
        merchantId: payout.merchantId,
      });

      if (result?.status === 'pending_signatures') {
        // Waiting on additional platform signers; stays SUBMITTED.
        this.logger.log(
          `Payout ${payout.id} awaiting multi-sig (${result.multiSigTransactionId})`,
        );
        return payout;
      }
      if (!result?.hash) {
        throw new Error('Stellar submission returned no transaction hash');
      }

      payout.status = PayoutStatus.COMPLETED;
      payout.transactionHash = result.hash;
      payout.completedAt = new Date();
      payout = await this.payoutRepo.save(payout);
      await this.dispatchEvent(payout, 'payout.completed');
      return payout;
    } catch (error) {
      payout.status = PayoutStatus.FAILED;
      payout.failureReason = error instanceof Error ? error.message : String(error);
      payout.failedAt = new Date();
      payout = await this.payoutRepo.save(payout);
      this.logger.error(`Payout ${payout.id} failed: ${payout.failureReason}`);
      await this.dispatchEvent(payout, 'payout.failed');
      return payout;
    }
  }

  /**
   * available = credited payments - settled to the merchant - active payouts.
   * Held reserves are part of the settled total, so they are never available.
   */
  private async computeBalance(
    manager: EntityManager,
    merchantId: string,
    currency: string,
  ): Promise<PayoutBalance> {
    const [credit] = await manager.query(
      `SELECT COALESCE(SUM("netAmount" - "refundedAmount"), 0)::text AS total
         FROM "payments"
        WHERE "merchantId" = $1 AND "currency" = $2 AND "status" = ANY($3)`,
      [merchantId, currency, CREDITED_PAYMENT_STATUSES],
    );
    const [settled] = await manager.query(
      `SELECT COALESCE(SUM("totalAmount"), 0)::text AS total
         FROM "settlements"
        WHERE "merchantId" = $1 AND "currency" = $2 AND "status" = $3`,
      [merchantId, currency, SettlementStatus.COMPLETED],
    );
    const paidOut = await this.sumPayoutsSince(manager, merchantId, currency, null);

    const creditedUnits = toUnits(credit.total);
    const settledUnits = toUnits(settled.total);
    const available = creditedUnits - settledUnits - paidOut;

    return {
      currency,
      available: fromUnits(available > 0n ? available : 0n),
      credited: fromUnits(creditedUnits),
      settled: fromUnits(settledUnits),
      paidOut: fromUnits(paidOut),
    };
  }

  private async sumPayoutsSince(
    manager: EntityManager,
    merchantId: string,
    currency: string,
    since: Date | null,
  ): Promise<bigint> {
    const params: unknown[] = [merchantId, currency, ACTIVE_PAYOUT_STATUSES];
    let sql = `SELECT COALESCE(SUM("amount"), 0)::text AS total
                 FROM "payouts"
                WHERE "merchantId" = $1 AND "currency" = $2 AND "status" = ANY($3)`;
    if (since) {
      params.push(since);
      sql += ` AND "createdAt" >= $4`;
    }
    const [row] = await manager.query(sql, params);
    return toUnits(row.total);
  }

  private async getDailyLimit(
    manager: EntityManager,
    merchantId: string,
    currency: string,
  ): Promise<string> {
    const override = await manager.findOne(MerchantPayoutLimit, {
      where: { merchantId, currency },
    });
    return override ? override.dailyLimit : this.defaultDailyLimit;
  }

  private async dispatchEvent(payout: Payout, event: string): Promise<void> {
    const payload = {
      payoutId: payout.id,
      status: payout.status,
      destination: payout.destination,
      amount: payout.amount,
      currency: payout.currency,
      memo: payout.memo,
      reference: payout.reference,
      transactionHash: payout.transactionHash,
      failureReason: payout.failureReason,
    };

    try {
      this.eventsService.emit(payout.merchantId, event, payload);
      await this.webhooksService.dispatchEventToMerchant(payout.merchantId, event, payload);
    } catch (error) {
      this.logger.error(`Failed to dispatch ${event} for payout ${payout.id}`, error);
    }
  }
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
