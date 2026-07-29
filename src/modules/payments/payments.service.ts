import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  LessThanOrEqual,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { Payment, PaymentStatus } from './payment.entity';
import { Refund } from './refund.entity';
import { PaymentSplit, PaymentSplitStatus } from './payment-split.entity';
import { MerchantFeeConfig } from './merchant-fee-config.entity';
import { UpsertMerchantFeeConfigDto } from './dto/upsert-merchant-fee-config.dto';
import { PaymentFeeReportDto } from './dto/payment-fee-report.dto';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { PaymentWebhookDto } from './dto/payment-webhook.dto';
import { GetPaymentsDto, PaymentSortBy } from './dto/get-payments.dto';
import { SortOrder } from '../../common/dto/pagination.dto';
import {
  CursorPaginatedResult,
  PaginatedResult,
} from '../../common/interfaces/paginated-result.interface';
import { AppLogger } from '../logger/logger.service';
import { Logger } from 'pino';
import { PaymentSseService } from './payment-sse.service';
import { EmailNotificationService } from '../notifications/email-notification.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { StellarService } from '../stellar/stellar.service';

const DEFAULT_PAYMENT_EXPIRY_SECONDS = 1800;

@Injectable()
export class PaymentsService {
  private readonly logger: Logger;

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    @InjectRepository(Refund)
    private readonly refundRepository: Repository<Refund>,
    @InjectRepository(MerchantFeeConfig)
    private readonly merchantFeeConfigRepository: Repository<MerchantFeeConfig>,
    @InjectRepository(PaymentSplit)
    private readonly paymentSplitRepository: Repository<PaymentSplit>,
    private readonly dataSource: DataSource,
    appLogger: AppLogger,
    private readonly paymentSseService: PaymentSseService,
    private readonly emailNotificationService: EmailNotificationService,
    private readonly webhooksService: WebhooksService,
    private readonly configService: ConfigService,
    private readonly stellarService: StellarService,
  ) {
    this.logger = appLogger.child({ module: PaymentsService.name });
  }

  private async ensurePaymentLimits(dto: CreatePaymentDto): Promise<void> {
    const amount = Number(dto.amount);
    const min = Number(
      this.configService.get<string>('PAYMENT_MIN_AMOUNT', '0'),
    );
    const max = Number(
      this.configService.get<string>('PAYMENT_MAX_AMOUNT', '0'),
    );
    const dailyLimit = Number(
      this.configService.get<string>('PAYMENT_DAILY_LIMIT_PER_USER', '0'),
    );

    if (min && amount < min) {
      throw new UnprocessableEntityException(
        `Payment amount ${amount} is below the minimum allowed amount of ${min}`,
      );
    }
    if (max && amount > max) {
      throw new UnprocessableEntityException(
        `Payment amount ${amount} exceeds the maximum allowed amount of ${max}`,
      );
    }

    if (!dailyLimit) return;

    const userKey =
      dto.payerEmail ?? dto.merchantEmail ?? dto.merchantId ?? 'anonymous';
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);

    const { sum } = await this.paymentRepository
      .createQueryBuilder('payment')
      .select('COALESCE(SUM(payment.amount), 0)', 'sum')
      .where('payment.createdAt >= :start', { start })
      .andWhere('payment.createdAt <= :end', { end })
      .andWhere(
        '(payment.payerEmail = :userKey OR payment.merchantEmail = :userKey OR payment.merchantId = :userKey)',
        { userKey },
      )
      .getRawOne();

    if (Number(sum) + amount > dailyLimit) {
      throw new UnprocessableEntityException(
        `Payment amount ${amount} would exceed the daily limit of ${dailyLimit} for ${userKey}`,
      );
    }
  }

  private async calculateFee(
    merchantId: string | undefined,
    amount: number,
  ): Promise<{ feeAmount: number; netAmount: number; feeBreakdown: string }> {
    if (!merchantId) {
      return {
        feeAmount: 0,
        netAmount: Number(amount.toFixed(2)),
        feeBreakdown: 'no-fee-config',
      };
    }

    const config = await this.merchantFeeConfigRepository.findOneBy({
      merchantId,
    });
    if (!config) {
      return {
        feeAmount: 0,
        netAmount: Number(amount.toFixed(2)),
        feeBreakdown: 'no-fee-config',
      };
    }

    const flatFee = Number(config.flatFee ?? 0);
    const percentageFee = Number(config.percentageFee ?? 0);
    const minFee = Number(config.minFee ?? 0);
    const percentageValue = (amount * percentageFee) / 100;
    const feeAmount = Math.max(flatFee + percentageValue, minFee);
    return {
      feeAmount: Number(feeAmount.toFixed(2)),
      netAmount: Number(Math.max(0, amount - feeAmount).toFixed(2)),
      feeBreakdown: `flat:${flatFee};percentage:${percentageFee}%;min:${minFee}`,
    };
  }

  async upsertMerchantFeeConfig(
    merchantId: string,
    dto: UpsertMerchantFeeConfigDto,
  ): Promise<MerchantFeeConfig> {
    let config = await this.merchantFeeConfigRepository.findOneBy({
      merchantId,
    });
    if (!config) {
      config = this.merchantFeeConfigRepository.create({ merchantId });
    }
    if (dto.flatFee !== undefined) config.flatFee = dto.flatFee;
    if (dto.percentageFee !== undefined)
      config.percentageFee = dto.percentageFee;
    if (dto.minFee !== undefined) config.minFee = dto.minFee;
    return this.merchantFeeConfigRepository.save(config);
  }

  async getFeeReport(merchantId: string): Promise<PaymentFeeReportDto> {
    const payments = await this.paymentRepository.find({
      where: { merchantId },
    });
    const totalGrossAmount = payments.reduce(
      (sum, payment) => sum + Number(payment.amount || 0),
      0,
    );
    const totalFeeAmount = payments.reduce(
      (sum, payment) => sum + Number(payment.feeAmount || 0),
      0,
    );
    return {
      merchantId,
      totalGrossAmount: Number(totalGrossAmount.toFixed(2)),
      totalFeeAmount: Number(totalFeeAmount.toFixed(2)),
      totalNetAmount: Number((totalGrossAmount - totalFeeAmount).toFixed(2)),
    };
  }

  /**
   * Create a payment with transaction support and idempotency key handling
   * Ensures atomic operation - either fully succeeds or rolls back
   * @param createPaymentDto - Payment creation data
   * @param idempotencyKey - Optional idempotency key for request deduplication
   * @returns Created payment
   */
  async create(createPaymentDto: CreatePaymentDto): Promise<Payment> {
    const queryRunner = this.dataSource.createQueryRunner();

    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();

      this.logger.debug(
        `Starting payment creation transaction for amount: ${createPaymentDto.amount}`,
      );

      await this.ensurePaymentLimits(createPaymentDto);
      const fee = await this.calculateFee(
        createPaymentDto.merchantId,
        Number(createPaymentDto.amount),
      );
      const expiresInSeconds =
        createPaymentDto.expiresIn ?? this.getDefaultExpirySeconds();

      const payment = queryRunner.manager.create(Payment, {
        ...createPaymentDto,
        merchantEmail: createPaymentDto.merchantEmail || null,
        payerEmail: createPaymentDto.payerEmail || null,
        feeAmount: fee.feeAmount,
        netAmount: fee.netAmount,
        feeBreakdown: fee.feeBreakdown,
        status: PaymentStatus.PENDING,
        expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
      });

      const savedPayment = await queryRunner.manager.save(payment);

      if (createPaymentDto.splits?.length) {
        const splits = createPaymentDto.splits.map((split) =>
          queryRunner.manager.create(PaymentSplit, {
            paymentId: savedPayment.id,
            recipientAddress: split.recipientAddress,
            percentage: split.percentage,
            amount: Number(
              ((Number(savedPayment.amount) * split.percentage) / 100).toFixed(
                2,
              ),
            ),
            status: PaymentSplitStatus.PENDING,
          }),
        );
        await queryRunner.manager.save(splits);
      }

      await queryRunner.commitTransaction();
      this.logger.info(`Payment created successfully: ${savedPayment.id}`);

      return savedPayment;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(
        `Payment creation failed and rolled back: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async createBulk(
    createPaymentDtos: CreatePaymentDto[],
  ): Promise<{ created: number; payments: Payment[] }> {
    const queryRunner = this.dataSource.createQueryRunner();

    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();

      this.logger.debug(
        `Starting bulk payment creation transaction for ${
          createPaymentDtos.length
        } items.`,
      );

      const paymentPayloads = await Promise.all(
        createPaymentDtos.map(async (createPaymentDto) => {
          await this.ensurePaymentLimits(createPaymentDto);
          const fee = await this.calculateFee(
            createPaymentDto.merchantId,
            Number(createPaymentDto.amount),
          );
          return {
            ...createPaymentDto,
            feeAmount: fee.feeAmount,
            netAmount: fee.netAmount,
            feeBreakdown: fee.feeBreakdown,
            status: PaymentStatus.PENDING,
            expiresAt: new Date(
              Date.now() +
                (createPaymentDto.expiresIn ?? this.getDefaultExpirySeconds()) *
                  1000,
            ),
          };
        }),
      );

      const payments = paymentPayloads.map((createPaymentDto) =>
        queryRunner.manager.create(Payment, {
          ...createPaymentDto,
          status: PaymentStatus.PENDING,
          expiresAt: new Date(
            Date.now() +
              (createPaymentDto.expiresIn ?? this.getDefaultExpirySeconds()) *
                1000,
          ),
        }),
      );

      const savedPayments = await queryRunner.manager.save(payments);

      await queryRunner.commitTransaction();
      this.logger.info(
        `Bulk payment creation succeeded: ${savedPayments.length} payments created.`,
      );

      return {
        created: Array.isArray(savedPayments) ? savedPayments.length : 0,
        payments: Array.isArray(savedPayments)
          ? savedPayments
          : [savedPayments],
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(
        `Bulk payment creation failed and rolled back: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async findAll(
    getPaymentsDto: GetPaymentsDto,
  ): Promise<CursorPaginatedResult<Payment> | PaginatedResult<Payment>> {
    if (getPaymentsDto.cursor) {
      return this.findWithCursor(getPaymentsDto);
    }
    return this.findWithOffset(getPaymentsDto);
  }

  private async findWithOffset(
    dto: GetPaymentsDto,
  ): Promise<PaginatedResult<Payment>> {
    const query = this.buildFilterQuery(dto);

    const page = dto.page || 1;
    const limit = dto.limit || 20;
    const skip = (page - 1) * limit;
    query.skip(skip).take(limit);

    this.applyOrder(query, dto);

    const [data, total] = await query.getManyAndCount();

    return { data, total, page, limit };
  }

  private async findWithCursor(
    dto: GetPaymentsDto,
  ): Promise<CursorPaginatedResult<Payment>> {
    const decoded = this.decodeCursor(dto.cursor!);
    const limit = dto.limit || 20;
    const order = dto.order || SortOrder.DESC;
    const sortBy = dto.sortBy || PaymentSortBy.CREATED_AT;

    const query = this.buildFilterQuery(dto);

    this.applyCursorCondition(query, sortBy, order, decoded);

    query.take(limit + 1);
    this.applyOrder(query, dto);

    const payments = await query.getMany();

    const hasMore = payments.length > limit;
    if (hasMore) {
      payments.pop();
    }

    const lastPayment = payments[payments.length - 1];
    const nextCursor = lastPayment
      ? this.encodeCursor(sortBy, lastPayment)
      : null;

    return { data: payments, nextCursor, hasMore };
  }

  private buildFilterQuery(dto: GetPaymentsDto): SelectQueryBuilder<Payment> {
    const query = this.paymentRepository.createQueryBuilder('payment');

    if (dto.status) {
      query.andWhere('payment.status = :status', { status: dto.status });
    }

    if (dto.currency) {
      query.andWhere('payment.currency = :currency', {
        currency: dto.currency,
      });
    }

    if (dto.minAmount !== undefined) {
      query.andWhere('payment.amount >= :minAmount', {
        minAmount: dto.minAmount,
      });
    }

    if (dto.maxAmount !== undefined) {
      query.andWhere('payment.amount <= :maxAmount', {
        maxAmount: dto.maxAmount,
      });
    }

    if (dto.from) {
      query.andWhere('payment.createdAt >= :fromDate', { fromDate: dto.from });
    }

    if (dto.to) {
      query.andWhere('payment.createdAt <= :toDate', { toDate: dto.to });
    }

    if (dto.search) {
      const searchTerm = `%${dto.search}%`;
      query.andWhere(
        '(payment.description ILIKE :search OR payment.externalReference ILIKE :search)',
        { search: searchTerm },
      );
    }

    if (dto.metadata) {
      const entries = Object.entries(dto.metadata);
      entries.forEach(([key, value], i) => {
        query.andWhere(`payment.metadata->>'${key}' = :metaVal${i}`, {
          [`metaVal${i}`]: value,
        });
      });
    }

    return query;
  }

  private applyOrder(
    query: SelectQueryBuilder<Payment>,
    dto: GetPaymentsDto,
  ): void {
    const sortBy = dto.sortBy || PaymentSortBy.CREATED_AT;
    const order = dto.order || SortOrder.DESC;

    switch (sortBy) {
      case PaymentSortBy.CREATED_AT:
        query.orderBy('payment.createdAt', order);
        break;
      case PaymentSortBy.AMOUNT:
        query.orderBy('payment.amount', order);
        break;
      case PaymentSortBy.STATUS:
        query.orderBy('payment.status', order);
        break;
    }

    query.addOrderBy('payment.id', order);
  }

  private applyCursorCondition(
    query: SelectQueryBuilder<Payment>,
    sortBy: PaymentSortBy,
    order: SortOrder,
    decoded: { sortField: string; sortValue: string; paymentId: string },
  ): void {
    const { sortValue, paymentId } = decoded;
    const isDesc = order === SortOrder.DESC;
    const operator = isDesc ? '<' : '>';
    const orOperator = isDesc ? '<' : '>';

    const sortColumn = this.resolveSortColumn(sortBy);

    query.andWhere(
      `(${sortColumn} ${operator} :cursorValue) OR (${sortColumn} = :cursorValueEq AND payment.id ${orOperator} :cursorId)`,
      {
        cursorValue: this.parseSortValue(sortBy, sortValue),
        cursorValueEq: this.parseSortValue(sortBy, sortValue),
        cursorId: paymentId,
      },
    );
  }

  private resolveSortColumn(sortBy: PaymentSortBy): string {
    switch (sortBy) {
      case PaymentSortBy.CREATED_AT:
        return 'payment.createdAt';
      case PaymentSortBy.AMOUNT:
        return 'payment.amount';
      case PaymentSortBy.STATUS:
        return 'payment.status';
    }
  }

  private parseSortValue(sortBy: PaymentSortBy, value: string): unknown {
    if (sortBy === PaymentSortBy.AMOUNT) {
      return Number(value);
    }
    return value;
  }

  private encodeCursor(sortBy: PaymentSortBy, payment: Payment): string {
    let sortValue: string;
    switch (sortBy) {
      case PaymentSortBy.CREATED_AT:
        sortValue = (payment.createdAt as Date).toISOString();
        break;
      case PaymentSortBy.AMOUNT:
        sortValue = String(payment.amount);
        break;
      case PaymentSortBy.STATUS:
        sortValue = payment.status;
        break;
    }
    const raw = `${sortBy}:${sortValue}:${payment.id}`;
    return Buffer.from(raw, 'utf-8').toString('base64');
  }

  private decodeCursor(cursor: string): {
    sortField: string;
    sortValue: string;
    paymentId: string;
  } {
    let decoded: string;
    try {
      decoded = Buffer.from(cursor, 'base64').toString('utf-8');
    } catch {
      throw new BadRequestException('Invalid cursor format');
    }

    const separatorIndex = decoded.indexOf(':');
    if (separatorIndex === -1) {
      throw new BadRequestException('Invalid cursor format');
    }

    const sortField = decoded.substring(0, separatorIndex);
    const rest = decoded.substring(separatorIndex + 1);

    const lastColonIndex = rest.lastIndexOf(':');
    if (lastColonIndex === -1) {
      throw new BadRequestException('Invalid cursor format');
    }

    const sortValue = rest.substring(0, lastColonIndex);
    const paymentId = rest.substring(lastColonIndex + 1);

    if (!sortField || !paymentId) {
      throw new BadRequestException('Invalid cursor format');
    }

    return { sortField, sortValue, paymentId };
  }

  async findOne(id: string): Promise<Payment> {
    const payment = await this.paymentRepository.findOneBy({ id });
    if (!payment) {
      throw new NotFoundException(`Payment with ID ${id} not found`);
    }
    return payment;
  }

  async getRefunds(paymentId: string): Promise<Refund[]> {
    return await this.refundRepository.find({
      where: { paymentId },
      order: { createdAt: 'DESC' },
    });
  }

  async refund(
    id: string,
    refundDto: RefundPaymentDto,
    initiatedBy?: string,
  ): Promise<{ payment: Payment; refund: Refund }> {
    const queryRunner = this.dataSource.createQueryRunner();

    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();

      const payment = await queryRunner.manager.findOneBy(Payment, { id });

      if (!payment) {
        throw new NotFoundException(`Payment with ID ${id} not found`);
      }

      if (payment.status === PaymentStatus.PENDING) {
        throw new ConflictException(
          'Cannot refund a payment that is still pending',
        );
      }

      if (payment.status === PaymentStatus.REFUNDED) {
        throw new ConflictException('Payment is already fully refunded');
      }

      if (payment.status === PaymentStatus.FAILED) {
        throw new ConflictException('Cannot refund a failed payment');
      }

      const refundAmount =
        refundDto.amount ??
        Number(payment.amount) - Number(payment.refundedAmount || 0);
      const remainingAmount =
        Number(payment.amount) - Number(payment.refundedAmount || 0);

      if (refundAmount > remainingAmount) {
        throw new ConflictException(
          `Refund amount ${refundAmount} exceeds remaining refundable amount ${remainingAmount}`,
        );
      }

      const refund = queryRunner.manager.create(Refund, {
        paymentId: id,
        amount: refundAmount,
        reason: refundDto.reason,
        initiatedBy: initiatedBy ?? null,
      });

      const savedRefund = await queryRunner.manager.save(refund);

      payment.refundedAmount =
        Number(payment.refundedAmount || 0) + refundAmount;

      if (payment.refundedAmount >= Number(payment.amount)) {
        payment.status = PaymentStatus.REFUNDED;
      } else {
        payment.status = PaymentStatus.PARTIALLY_REFUNDED;
      }

      const updatedPayment = await queryRunner.manager.save(payment);

      await queryRunner.commitTransaction();
      this.logger.info(
        `Refund processed: ${savedRefund.id} for payment ${id}, amount: ${refundAmount}`,
      );

      this.paymentSseService.emit(updatedPayment);

      await this.sendRefundNotifications(updatedPayment, savedRefund);

      return { payment: updatedPayment, refund: savedRefund };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`Refund failed and rolled back: ${error.message}`);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Handle webhook with transaction support
   * Ensures status update is atomic
   */
  async handleWebhook(webhookDto: PaymentWebhookDto): Promise<Payment> {
    const queryRunner = this.dataSource.createQueryRunner();

    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();

      this.logger.debug(
        `Starting webhook transaction for payment: ${webhookDto.paymentId}, status: ${webhookDto.status}`,
      );

      const payment = await queryRunner.manager.findOneBy(Payment, {
        id: webhookDto.paymentId,
      });

      if (!payment) {
        throw new NotFoundException(
          `Payment with ID ${webhookDto.paymentId} not found`,
        );
      }

      payment.status = webhookDto.status;
      if (webhookDto.externalReference) {
        payment.externalReference = webhookDto.externalReference;
      }

      const updatedPayment = await queryRunner.manager.save(payment);

      await queryRunner.commitTransaction();
      this.logger.info(
        `Webhook processed successfully for payment: ${updatedPayment.id}`,
      );

      this.paymentSseService.emit(updatedPayment);

      if (updatedPayment.status === PaymentStatus.COMPLETED) {
        await this.sendPaymentConfirmedNotifications(updatedPayment);
        await this.processSplitsForPayment(updatedPayment);
      }

      return updatedPayment;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(
        `Webhook transaction failed and rolled back: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async findForExport(dto: GetPaymentsDto): Promise<Payment[]> {
    const query = this.paymentRepository.createQueryBuilder('payment');

    if (dto.status) {
      query.andWhere('payment.status = :status', { status: dto.status });
    }
    if (dto.currency) {
      query.andWhere('payment.currency = :currency', {
        currency: dto.currency,
      });
    }
    if (dto.minAmount !== undefined) {
      query.andWhere('payment.amount >= :minAmount', {
        minAmount: dto.minAmount,
      });
    }
    if (dto.maxAmount !== undefined) {
      query.andWhere('payment.amount <= :maxAmount', {
        maxAmount: dto.maxAmount,
      });
    }
    if (dto.from) {
      query.andWhere('payment.createdAt >= :fromDate', { fromDate: dto.from });
    }
    if (dto.to) {
      query.andWhere('payment.createdAt <= :toDate', { toDate: dto.to });
    }
    if (dto.search) {
      const searchTerm = `%${dto.search}%`;
      query.andWhere(
        '(payment.description ILIKE :search OR payment.externalReference ILIKE :search)',
        { search: searchTerm },
      );
    }

    query.orderBy('payment.createdAt', 'DESC').take(10000);
    return query.getMany();
  }

  /**
   * Cancel a payment
   * Only PENDING payments can be cancelled
   */
  async cancel(id: string): Promise<Payment> {
    const payment = await this.paymentRepository.findOneBy({ id });

    if (!payment) {
      throw new NotFoundException(`Payment with ID ${id} not found`);
    }

    // Check if payment is in a terminal state
    const terminalStates = [
      PaymentStatus.COMPLETED,
      PaymentStatus.FAILED,
      PaymentStatus.CANCELLED,
      PaymentStatus.REFUNDED,
      PaymentStatus.PARTIALLY_REFUNDED,
    ];

    if (terminalStates.includes(payment.status)) {
      throw new ConflictException(
        `Cannot cancel payment with status ${payment.status}. Only PENDING payments can be cancelled.`,
      );
    }

    payment.status = PaymentStatus.CANCELLED;
    payment.cancelledAt = new Date();
    payment.updatedAt = new Date();

    const updatedPayment = await this.paymentRepository.save(payment);
    this.logger.info(
      { paymentId: id, cancelledAt: updatedPayment.cancelledAt },
      'Payment cancelled successfully',
    );

    this.paymentSseService.emit(updatedPayment);
    return updatedPayment;
  }

  private getDefaultExpirySeconds(): number {
    return this.configService.get<number>(
      'PAYMENT_DEFAULT_EXPIRY_SECONDS',
      DEFAULT_PAYMENT_EXPIRY_SECONDS,
    );
  }

  /**
   * Sweeps for PENDING payments past their expiresAt and transitions them to EXPIRED.
   * Runs every minute per acceptance criteria for #176.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async expirePendingPayments(): Promise<void> {
    const expiredPayments = await this.paymentRepository.find({
      where: {
        status: PaymentStatus.PENDING,
        expiresAt: LessThanOrEqual(new Date()),
      },
    });

    for (const payment of expiredPayments) {
      await this.expirePayment(payment);
    }
  }

  private async expirePayment(payment: Payment): Promise<void> {
    payment.status = PaymentStatus.EXPIRED;
    payment.expiredAt = new Date();

    const updatedPayment = await this.paymentRepository.save(payment);
    this.logger.info(
      { paymentId: payment.id },
      'Payment expired after exceeding its expiry window',
    );

    this.paymentSseService.emit(updatedPayment);

    if (updatedPayment.merchantId) {
      await this.webhooksService
        .dispatchEventToMerchant(updatedPayment.merchantId, 'payment.expired', {
          paymentId: updatedPayment.id,
          amount: updatedPayment.amount,
          currency: updatedPayment.currency,
          expiredAt: updatedPayment.expiredAt,
        })
        .catch((e) =>
          this.logger.error('Failed to dispatch payment.expired webhook', e),
        );
    }
  }

  /**
   * Executes each split as a separate Stellar transaction once the parent payment
   * has completed. On partial failure, the parent payment is marked
   * PARTIALLY_COMPLETED per #178 acceptance criteria.
   */
  private async processSplitsForPayment(payment: Payment): Promise<void> {
    const splits = await this.paymentSplitRepository.find({
      where: { paymentId: payment.id, status: PaymentSplitStatus.PENDING },
    });

    if (splits.length === 0) return;

    let failedCount = 0;

    for (const split of splits) {
      try {
        const result = await this.stellarService.sendPayment(
          split.recipientAddress,
          String(split.amount),
          undefined,
          payment.merchantId ?? undefined,
        );

        split.status = PaymentSplitStatus.COMPLETED;
        split.stellarTransactionHash = result?.hash ?? null;
      } catch (error) {
        failedCount += 1;
        split.status = PaymentSplitStatus.FAILED;
        split.failureReason =
          error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(
          { paymentId: payment.id, splitId: split.id },
          `Split execution failed: ${split.failureReason}`,
        );
      }

      await this.paymentSplitRepository.save(split);
    }

    if (failedCount > 0) {
      payment.status = PaymentStatus.PARTIALLY_COMPLETED;
      const updatedPayment = await this.paymentRepository.save(payment);
      this.paymentSseService.emit(updatedPayment);
    }

    if (payment.merchantId) {
      await this.webhooksService
        .dispatchEventToMerchant(
          payment.merchantId,
          'payment.split_processed',
          {
            paymentId: payment.id,
            totalSplits: splits.length,
            failedSplits: failedCount,
            status: payment.status,
          },
        )
        .catch((e) =>
          this.logger.error(
            'Failed to dispatch payment.split_processed webhook',
            e,
          ),
        );
    }
  }

  private async sendPaymentConfirmedNotifications(
    payment: Payment,
  ): Promise<void> {
    if (payment.merchantEmail) {
      await this.emailNotificationService
        .sendMerchantPaymentReceived(
          payment.merchantEmail,
          null,
          payment.id,
          String(payment.amount),
          payment.currency,
          payment.description,
        )
        .catch(() => {});
    }

    if (payment.payerEmail) {
      await this.emailNotificationService
        .sendPayerPaymentConfirmed(
          payment.payerEmail,
          null,
          payment.id,
          String(payment.amount),
          payment.currency,
          payment.description,
        )
        .catch(() => {});
    }
  }

  private async sendRefundNotifications(
    payment: Payment,
    refund: Refund,
  ): Promise<void> {
    if (payment.merchantEmail) {
      await this.emailNotificationService
        .sendMerchantRefundIssued(
          payment.merchantEmail,
          null,
          payment.id,
          refund.id,
          String(refund.amount),
          String(payment.amount),
          payment.currency,
          refund.reason,
        )
        .catch(() => {});
    }

    if (payment.payerEmail) {
      await this.emailNotificationService
        .sendPayerRefundProcessed(
          payment.payerEmail,
          null,
          payment.id,
          refund.id,
          String(refund.amount),
          payment.currency,
          refund.reason,
        )
        .catch(() => {});
    }
  }
}
