import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import {
  UnmatchedTransaction,
  UnmatchedTransactionStatus,
} from './entities/unmatched-transaction.entity';
import { Payment, PaymentStatus } from '../payments/payment.entity';
import { EventsService } from '../events/events.service';
import { ListUnmatchedTransactionsDto } from './dto/list-unmatched-transactions.dto';
import { MatchUnmatchedTransactionDto } from './dto/match-unmatched-transaction.dto';
import { AppLogger } from '../logger/logger.service';
import { Logger } from 'pino';

export interface StoreUnmatchedTxInput {
  transactionHash: string;
  fromAddress: string;
  amount: string;
  assetCode: string;
  memo: string | null;
}

@Injectable()
export class UnmatchedTransactionsService {
  private readonly logger: Logger;

  constructor(
    @InjectRepository(UnmatchedTransaction)
    private readonly repo: Repository<UnmatchedTransaction>,
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    private readonly dataSource: DataSource,
    private readonly eventsService: EventsService,
    appLogger: AppLogger,
  ) {
    this.logger = appLogger.child({ module: UnmatchedTransactionsService.name });
  }

  /**
   * Persist an incoming on-chain transaction that could not be matched to a
   * pending payment.  Idempotent: a duplicate transactionHash is silently
   * ignored and the existing record is returned.
   */
  async store(input: StoreUnmatchedTxInput): Promise<UnmatchedTransaction> {
    const existing = await this.repo.findOneBy({
      transactionHash: input.transactionHash,
    });
    if (existing) return existing;

    const record = this.repo.create({
      ...input,
      status: UnmatchedTransactionStatus.PENDING,
      matchedPaymentId: null,
      resolvedBy: null,
      resolvedAt: null,
    });

    const saved = await this.repo.save(record);

    this.eventsService.emit(null, 'transaction.unmatched', {
      id: saved.id,
      transactionHash: saved.transactionHash,
      fromAddress: saved.fromAddress,
      amount: saved.amount,
      assetCode: saved.assetCode,
      memo: saved.memo,
    });

    this.logger.info(
      { id: saved.id, transactionHash: saved.transactionHash },
      'Stored unmatched on-chain transaction',
    );

    return saved;
  }

  async findAll(
    dto: ListUnmatchedTransactionsDto,
  ): Promise<{ data: UnmatchedTransaction[]; total: number }> {
    const qb = this.repo.createQueryBuilder('ut').orderBy('ut.createdAt', 'DESC');

    if (dto.status) {
      qb.where('ut.status = :status', { status: dto.status });
    }

    const limit = dto.limit ?? 20;
    const offset = dto.offset ?? 0;

    const [data, total] = await qb.skip(offset).take(limit).getManyAndCount();
    return { data, total };
  }

  async findOne(id: string): Promise<UnmatchedTransaction> {
    const record = await this.repo.findOneBy({ id });
    if (!record) throw new NotFoundException(`Unmatched transaction ${id} not found`);
    return record;
  }

  /**
   * Manually match an unmatched transaction to a pending payment.
   * Completes the payment atomically and emits a ledger entry via the event.
   */
  async match(
    id: string,
    dto: MatchUnmatchedTransactionDto,
    resolvedBy: string,
  ): Promise<UnmatchedTransaction> {
    return this.dataSource.transaction(async (em) => {
      const record = await em.findOne(UnmatchedTransaction, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });

      if (!record) throw new NotFoundException(`Unmatched transaction ${id} not found`);

      if (record.status !== UnmatchedTransactionStatus.PENDING) {
        throw new ConflictException(
          `Transaction ${id} has already been ${record.status.toLowerCase()}`,
        );
      }

      const payment = await em.findOne(Payment, {
        where: { id: dto.paymentId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!payment) throw new NotFoundException(`Payment ${dto.paymentId} not found`);

      if (payment.status !== PaymentStatus.PENDING) {
        throw new BadRequestException(
          `Payment ${dto.paymentId} is not in PENDING status (current: ${payment.status})`,
        );
      }

      payment.status = PaymentStatus.COMPLETED;
      if (!payment.externalReference) {
        payment.externalReference = record.transactionHash;
      }
      await em.save(Payment, payment);

      record.status = UnmatchedTransactionStatus.MATCHED;
      record.matchedPaymentId = payment.id;
      record.resolvedBy = resolvedBy;
      record.resolvedAt = new Date();
      const updated = await em.save(UnmatchedTransaction, record);

      this.logger.info(
        { id: record.id, paymentId: payment.id, resolvedBy },
        'Unmatched transaction manually matched to payment',
      );

      this.eventsService.emit(payment.merchantId, 'transaction.matched', {
        unmatchedTransactionId: record.id,
        paymentId: payment.id,
        transactionHash: record.transactionHash,
        resolvedBy,
      });

      return updated;
    });
  }

  /**
   * Mark an unmatched transaction as refunded (the actual Stellar refund is
   * handled externally; this endpoint records the outcome).
   */
  async markRefunded(id: string, resolvedBy: string): Promise<UnmatchedTransaction> {
    return this.dataSource.transaction(async (em) => {
      const record = await em.findOne(UnmatchedTransaction, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });

      if (!record) throw new NotFoundException(`Unmatched transaction ${id} not found`);

      if (record.status !== UnmatchedTransactionStatus.PENDING) {
        throw new ConflictException(
          `Transaction ${id} has already been ${record.status.toLowerCase()}`,
        );
      }

      record.status = UnmatchedTransactionStatus.REFUNDED;
      record.resolvedBy = resolvedBy;
      record.resolvedAt = new Date();
      const updated = await em.save(UnmatchedTransaction, record);

      this.logger.info(
        { id: record.id, resolvedBy },
        'Unmatched transaction marked as refunded',
      );

      return updated;
    });
  }
}
