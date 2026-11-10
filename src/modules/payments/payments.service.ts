import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  UnprocessableEntityException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  LessThan,
  LessThanOrEqual,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { Payment, PaymentStatus } from './payment.entity';
import { PaymentNote } from './payment-note.entity';
import { Invoice, InvoiceStatus } from '../invoices/invoice.entity';
import { Coupon } from '../coupons/coupon.entity';
import { PaymentLink } from '../payment-links/payment-link.entity';
import { assertCouponUsable, calculateCouponDiscount } from '../coupons/coupons.service';
import { Refund, RefundReasonCode, RefundStatus } from './refund.entity';
import { GetRefundsDto } from './dto/get-refunds.dto';
import { Dispute, DisputeStatus } from './dispute.entity';
import { MerchantSettings } from '../merchants/entities/merchant-settings.entity';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { RejectRefundDto } from './dto/reject-refund.dto';
import { PaymentSplit, PaymentSplitStatus } from './payment-split.entity';
import { MerchantFeeConfig } from './merchant-fee-config.entity';
import { UpsertMerchantFeeConfigDto } from './dto/upsert-merchant-fee-config.dto';
import { PaymentFeeReportDto } from './dto/payment-fee-report.dto';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { PaymentWebhookDto } from './dto/payment-webhook.dto';
import { GetPaymentsDto, PaymentSortBy } from './dto/get-payments.dto';
import { PaymentTimelineEvent } from './dto/payment-timeline.dto';
import { SortOrder } from '../../common/dto/pagination.dto';
import {
  CursorPaginatedResult,
  PaginatedResult,
} from '../../common/interfaces/paginated-result.interface';
import { AppLogger } from '../logger/logger.service';
import { Logger } from 'pino';
import { PaymentSseService } from './payment-sse.service';
import { EmailNotificationService } from '../notifications/email-notification.service';
import { normalizeLocale } from '../notifications/i18n/locale';
import { WebhooksService } from '../webhooks/webhooks.service';
import { PaymentLinksService } from '../payment-links/payment-links.service';
import { StellarService } from '../stellar/stellar.service';
import { UsersService } from '../users/users.service';
import { SettlementAdjustment } from '../settlements/entities/settlement-adjustment.entity';
import { LedgerAccount, LedgerReferenceType } from '../ledger/ledger-entry.entity';
import { appendLedgerTransaction } from '../ledger/ledger-transaction';
import { EventsService } from '../events/events.service';
import { Customer } from '../customers/customer.entity';
import { resolveCustomerForMerchant } from '../customers/customer-ownership';

const DEFAULT_PAYMENT_EXPIRY_SECONDS = 1800;
const DEFAULT_MAX_REFUNDS_PER_PAYMENT = 20;

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
    @InjectRepository(Dispute)
    private readonly disputeRepository: Repository<Dispute>,
    @InjectRepository(SettlementAdjustment)
    private readonly settlementAdjustmentRepository: Repository<SettlementAdjustment>,
    @InjectRepository(MerchantSettings)
    private readonly merchantSettingsRepository: Repository<MerchantSettings>,
    private readonly dataSource: DataSource,
    appLogger: AppLogger,
    private readonly paymentSseService: PaymentSseService,
    private readonly emailNotificationService: EmailNotificationService,
    private readonly webhooksService: WebhooksService,
    private readonly configService: ConfigService,
    private readonly stellarService: StellarService,
    private readonly usersService: UsersService,
    private readonly paymentLinksService: PaymentLinksService,
    private readonly eventsService: EventsService,
    private readonly auditLogsService: AuditLogsService,
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
      .andWhere('payment.currency = :currency', { currency: dto.currency })
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

  /**
   * Validate that merchantId corresponds to a real user/merchant.
   * Throws BadRequestException if merchantId is provided but doesn't exist.
   */
  private async validateMerchantId(merchantId: string | undefined): Promise<void> {
    if (!merchantId) {
      return; // merchantId is optional
    }

    try {
      await this.usersService.findOne(merchantId);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw new BadRequestException(
          `Invalid merchantId: merchant with ID '${merchantId}' does not exist`,
        );
      }
      throw error;
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

  async getMerchantFeeConfig(merchantId: string): Promise<{
    merchantId: string;
    flatFee: number;
    percentageFee: number;
    minFee: number;
  }> {
    const config = await this.merchantFeeConfigRepository.findOneBy({
      merchantId,
    });

    if (config) {
      return {
        merchantId: config.merchantId,
        flatFee: Number(config.flatFee ?? 0),
        percentageFee: Number(config.percentageFee ?? 0),
        minFee: Number(config.minFee ?? 0),
      };
    }

    return {
      merchantId,
      flatFee: 0,
      percentageFee: 0,
      minFee: 0,
    };
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
  async create(
    createPaymentDto: CreatePaymentDto,
    recurringPaymentId?: string,
    invoiceId?: string,
    authenticatedMerchantId?: string,
  ): Promise<Payment> {
    const queryRunner = this.dataSource.createQueryRunner();
    let limitWarnings: MerchantLimitWarning[] = [];
    let paymentMerchantId: string | undefined;

    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();

      let invoice: Invoice | null = null;
      if (invoiceId) {
        invoice = await queryRunner.manager.findOne(Invoice, {
          where: { id: invoiceId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!invoice || ![InvoiceStatus.OPEN, InvoiceStatus.OVERDUE].includes(invoice.status)) {
          throw new ConflictException('Invoice is not payable');
        }
        if (invoice.paymentId) {
          const previousPayment = await queryRunner.manager.findOne(Payment, {
            where: { id: invoice.paymentId },
          });
          if (
            previousPayment &&
            ![PaymentStatus.FAILED, PaymentStatus.CANCELLED, PaymentStatus.EXPIRED].includes(previousPayment.status)
          ) {
            throw new ConflictException('An invoice payment is already active or completed');
          }
          invoice.paymentId = null;
        }
      }

      let merchantId = createPaymentDto.merchantId;
      let coupon: Coupon | null = null;
      let discountAmount = 0;
      let amountToCharge = Number(createPaymentDto.amount);
      if (createPaymentDto.couponCode) {
        if (!createPaymentDto.paymentLinkId) {
          throw new BadRequestException('Coupons can only be used with a payment link');
        }
        const link = await queryRunner.manager.findOne(PaymentLink, {
          where: { id: createPaymentDto.paymentLinkId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!link || !link.isActive || (link.expiresAt && link.expiresAt <= new Date())) {
          throw new BadRequestException('Payment link is not available');
        }
        if (merchantId && merchantId !== link.merchantId) {
          throw new BadRequestException('Payment link does not belong to this merchant');
        }
        merchantId = link.merchantId;
        if (createPaymentDto.currency !== link.currency) {
          throw new BadRequestException('Payment currency does not match payment link');
        }
        const baseAmount = link.flexibleAmount
          ? Number(createPaymentDto.amount)
          : Number(link.amount);
        if (!link.flexibleAmount && Math.abs(baseAmount - Number(createPaymentDto.amount)) >= 0.005) {
          throw new BadRequestException('Payment amount does not match payment link');
        }
        if (link.flexibleAmount && link.minAmount !== null && baseAmount < Number(link.minAmount)) {
          throw new BadRequestException(`Payment amount must be at least ${link.minAmount}`);
        }
        const foundCoupon = await queryRunner.manager.findOne(Coupon, {
          where: { merchantId, code: createPaymentDto.couponCode.trim().toUpperCase() },
          lock: { mode: 'pessimistic_write' },
        });
        assertCouponUsable(foundCoupon, link.id, link.currency);
        coupon = foundCoupon;
        discountAmount = calculateCouponDiscount(baseAmount, coupon);
        amountToCharge = Number((baseAmount - discountAmount).toFixed(2));
        coupon.reservedRedemptions += 1;
        await queryRunner.manager.save(coupon);
      }
      if (createPaymentDto.customerId) {
        const expectedMerchantId = authenticatedMerchantId ?? createPaymentDto.merchantId;
        if (!expectedMerchantId) {
          throw new BadRequestException(
            'A merchant is required when customerId is provided',
          );
        }
        const customer = await resolveCustomerForMerchant(
          this.paymentRepository.manager.getRepository(Customer),
          createPaymentDto.customerId,
          expectedMerchantId,
          createPaymentDto.merchantId,
        );
        merchantId = customer.merchantId;
      }

      this.logger.debug(
        `Starting payment creation transaction for amount: ${createPaymentDto.amount}`,
      );

      // Validate merchantId if provided
      await this.validateMerchantId(merchantId);
      if (merchantId) {
        await this.usersService.assertMerchantActive(merchantId);
      }

      await this.ensurePaymentLimits({ ...createPaymentDto, amount: amountToCharge, merchantId });
      const fee = await this.calculateFee(
        merchantId,
        amountToCharge,
      );
      const expiresInSeconds =
        createPaymentDto.expiresIn ?? this.getDefaultExpirySeconds();

      const payment = queryRunner.manager.create(Payment, {
        ...createPaymentDto,
        merchantId: merchantId ?? null,
        amount: amountToCharge,
        recurringPaymentId: recurringPaymentId ?? null,
        invoiceId: invoice?.id ?? null,
        couponId: coupon?.id ?? null,
        discountAmount,
        couponRedemptionReserved: Boolean(coupon),
        merchantEmail: createPaymentDto.merchantEmail || null,
        payerEmail: createPaymentDto.payerEmail || null,
        payerLocale: createPaymentDto.payerLocale
          ? normalizeLocale(createPaymentDto.payerLocale)
          : null,
        feeAmount: fee.feeAmount,
        netAmount: fee.netAmount,
        feeBreakdown: fee.feeBreakdown,
        status: PaymentStatus.PENDING,
        expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
      });

      const savedPayment = await queryRunner.manager.save(payment);

      if (invoice) {
        invoice.paymentId = savedPayment.id;
        await queryRunner.manager.save(invoice);
      }

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
      await this.sendMerchantLimitWarnings(
        paymentMerchantId,
        createPaymentDto.currency,
        limitWarnings,
      );

      if (savedPayment.paymentLinkId) {
        savedPayment.successUrl = await this.paymentLinksService.getResolvedSuccessUrl(
          savedPayment.paymentLinkId,
          savedPayment.id,
        );
      }

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

  async createForInvoice(invoice: Invoice, payerEmail?: string): Promise<Payment> {
    const invoiceNumber = `INV-${String(invoice.number).padStart(6, '0')}`;
    return this.create(
      {
        amount: Number(invoice.total),
        currency: invoice.currency,
        merchantId: invoice.merchantId,
        payerEmail,
        description: `Payment for invoice ${invoiceNumber}`,
        dueDate: invoice.dueDate.toISOString(),
      } as CreatePaymentDto,
      undefined,
      invoice.id,
    );
  }

  async createBulk(
    createPaymentDtos: CreatePaymentDto[],
    authenticatedMerchantId?: string,
  ): Promise<{ created: number; payments: Payment[] }> {
    const queryRunner = this.dataSource.createQueryRunner();
    const limitWarnings: Array<{
      merchantId: string;
      currency: string;
      warnings: MerchantLimitWarning[];
    }> = [];

    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();

      const resolvedPaymentDtos = await Promise.all(
        createPaymentDtos.map(async (createPaymentDto) => {
          if (!createPaymentDto.customerId) {
            return authenticatedMerchantId
              ? { ...createPaymentDto, merchantId: authenticatedMerchantId }
              : createPaymentDto;
          }

          const expectedMerchantId =
            authenticatedMerchantId ?? createPaymentDto.merchantId;
          if (!expectedMerchantId) {
            throw new BadRequestException(
              'A merchant is required when customerId is provided',
            );
          }

          const customer = await resolveCustomerForMerchant(
            this.paymentRepository.manager.getRepository(Customer),
            createPaymentDto.customerId,
            expectedMerchantId,
            createPaymentDto.merchantId,
          );

          return {
            ...createPaymentDto,
            merchantId: customer.merchantId,
          };
        }),
      );

      this.logger.debug(
        `Starting bulk payment creation transaction for ${
          resolvedPaymentDtos.length
        } items.`,
      );

      // Validate all merchantIds upfront
      const uniqueMerchantIds = [
        ...new Set(
          resolvedPaymentDtos
            .map((dto) => dto.merchantId)
            .filter((id): id is string => id !== undefined),
        ),
      ];

      for (const merchantId of uniqueMerchantIds) {
        await this.validateMerchantId(merchantId);
        await this.usersService.assertMerchantActive(merchantId);
      }

      if (authenticatedMerchantId) {
        await this.usersService.assertMerchantActive(authenticatedMerchantId);
      }

      const batchTotals = new Map<string, number>();
      const paymentPayloads = [];
      for (const createPaymentDto of resolvedPaymentDtos) {
        await this.ensurePaymentLimits(createPaymentDto);
        const warnings = await this.merchantLimitsService.enforce(
          createPaymentDto.merchantId,
          createPaymentDto.currency,
          Number(createPaymentDto.amount),
          queryRunner.manager,
          batchTotals,
        );
        if (warnings.length && createPaymentDto.merchantId) {
          limitWarnings.push({
            merchantId: createPaymentDto.merchantId,
            currency: createPaymentDto.currency,
            warnings,
          });
        }
        const fee = await this.calculateFee(
          createPaymentDto.merchantId,
          Number(createPaymentDto.amount),
        );
        paymentPayloads.push({
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
        });
      }

      const payments = paymentPayloads.map((createPaymentDto) =>
        queryRunner.manager.create(Payment, {
          ...createPaymentDto,
          customerId: createPaymentDto.customerId ?? null,
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
      for (const warning of limitWarnings) {
        await this.sendMerchantLimitWarnings(
          warning.merchantId,
          warning.currency,
          warning.warnings,
        );
      }
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

  private async sendMerchantLimitWarnings(
    merchantId: string | undefined,
    currency: string,
    warnings: MerchantLimitWarning[],
  ): Promise<void> {
    if (!merchantId || warnings.length === 0) return;
    try {
      const merchant = await this.usersService.findOne(merchantId);
      for (const warning of warnings) {
        await this.emailNotificationService.sendMerchantVolumeLimitWarning(
          merchant.email,
          currency,
          warning.limitType,
          warning.limit,
          warning.currentVolume,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Unable to send merchant volume-limit warning for ${merchantId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async findAll(
    getPaymentsDto: GetPaymentsDto,
    scope?: { customerId: string; merchantId: string },
  ): Promise<CursorPaginatedResult<Payment> | PaginatedResult<Payment>> {
    if (getPaymentsDto.cursor) {
      return this.findWithCursor(getPaymentsDto, scope);
    }
    return this.findWithOffset(getPaymentsDto, scope);
  }

  async findCustomerPayments(
    customerId: string,
    merchantId: string,
    dto: GetPaymentsDto,
  ): Promise<
    (CursorPaginatedResult<Payment> | PaginatedResult<Payment>) & {
      summary: Array<{
        currency: string;
        totalPaid: number;
        totalRefunded: number;
        paymentCount: number;
        firstPaymentAt: Date | string | null;
        lastPaymentAt: Date | string | null;
      }>;
    }
  > {
    const [result, summary] = await Promise.all([
      this.findAll(dto, { customerId, merchantId }),
      this.getCustomerPaymentSummary(customerId, merchantId),
    ]);

    return { ...result, summary };
  }

  private async getCustomerPaymentSummary(
    customerId: string,
    merchantId: string,
  ): Promise<
    Array<{
      currency: string;
      totalPaid: number;
      totalRefunded: number;
      paymentCount: number;
      firstPaymentAt: Date | string | null;
      lastPaymentAt: Date | string | null;
    }>
  > {
    const rows = await this.paymentRepository
      .createQueryBuilder('payment')
      .select('payment.currency', 'currency')
      .addSelect('COALESCE(SUM(payment.amount), 0)', 'totalPaid')
      .addSelect('COALESCE(SUM(payment.refundedAmount), 0)', 'totalRefunded')
      .addSelect('COUNT(payment.id)', 'paymentCount')
      .addSelect('MIN(payment.createdAt)', 'firstPaymentAt')
      .addSelect('MAX(payment.createdAt)', 'lastPaymentAt')
      .where('payment.customerId = :customerId', { customerId })
      .andWhere('payment.merchantId = :merchantId', { merchantId })
      .andWhere('payment.status IN (:...summaryStatuses)', {
        summaryStatuses: [
          PaymentStatus.COMPLETED,
          PaymentStatus.PARTIALLY_REFUNDED,
          PaymentStatus.REFUNDED,
        ],
      })
      .groupBy('payment.currency')
      .orderBy('payment.currency', 'ASC')
      .getRawMany();

    return rows.map((row) => ({
      currency: row.currency,
      totalPaid: Number(row.totalPaid),
      totalRefunded: Number(row.totalRefunded),
      paymentCount: Number(row.paymentCount),
      firstPaymentAt: row.firstPaymentAt ?? null,
      lastPaymentAt: row.lastPaymentAt ?? null,
    }));
  }

  private async findWithOffset(
    dto: GetPaymentsDto,
    scope?: { customerId: string; merchantId: string },
  ): Promise<PaginatedResult<Payment>> {
    const query = this.buildFilterQuery(dto, scope);

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
    scope?: { customerId: string; merchantId: string },
  ): Promise<CursorPaginatedResult<Payment>> {
    const decoded = this.decodeCursor(dto.cursor!);
    const limit = dto.limit || 20;
    const order = dto.order || SortOrder.DESC;
    const sortBy = dto.sortBy || PaymentSortBy.CREATED_AT;

    const query = this.buildFilterQuery(dto, scope);

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

  private buildFilterQuery(
    dto: GetPaymentsDto,
    scope?: { customerId: string; merchantId: string },
  ): SelectQueryBuilder<Payment> {
    const query = this.paymentRepository.createQueryBuilder('payment');

    if (scope) {
      query.andWhere('payment.customerId = :customerId', {
        customerId: scope.customerId,
      });
      query.andWhere('payment.merchantId = :merchantId', {
        merchantId: scope.merchantId,
      });
    }

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

  async update(
    id: string,
    dto: UpdatePaymentDto,
    actorId: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<Payment> {
    const immutableFields = [
      'amount',
      'currency',
      'status',
      'merchant',
      'merchantId',
      'refundedAmount',
      'feeAmount',
      'netAmount',
      'settlementId',
      'customerId',
    ] as const;
    const attemptedImmutableFields = immutableFields.filter(
      (field) => dto[field] !== undefined,
    );
    if (attemptedImmutableFields.length > 0) {
      throw new BadRequestException(
        `Payment fields cannot be updated: ${attemptedImmutableFields.join(', ')}`,
      );
    }

    const editableFields = [
      'description',
      'metadata',
      'externalReference',
    ] as const;
    if (editableFields.every((field) => dto[field] === undefined)) {
      throw new BadRequestException(
        'At least one of description, metadata, or externalReference must be provided',
      );
    }

    const queryRunner = this.dataSource.createQueryRunner();
    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();

      const payment = await queryRunner.manager.findOneBy(Payment, {
        id,
        merchantId: actorId,
      });
      if (!payment) {
        throw new NotFoundException(`Payment with ID ${id} not found`);
      }

      const before = {
        description: payment.description,
        metadata: payment.metadata ? { ...payment.metadata } : null,
        externalReference: payment.externalReference,
      };
      const after = {
        description:
          dto.description === undefined ? before.description : dto.description,
        metadata:
          dto.metadata === undefined
            ? before.metadata
            : dto.metadata
              ? { ...dto.metadata }
              : null,
        externalReference:
          dto.externalReference === undefined
            ? before.externalReference
            : dto.externalReference,
      };
      const changedFields = editableFields.filter(
        (field) => !isDeepStrictEqual(before[field], after[field]),
      );

      if (changedFields.length === 0) {
        await queryRunner.commitTransaction();
        return payment;
      }

      payment.description = after.description;
      payment.metadata = after.metadata;
      payment.externalReference = after.externalReference;
      const updatedPayment = await queryRunner.manager.save(payment);

      const auditLog = queryRunner.manager.create(AuditLog, {
        actorId,
        actorType: 'user',
        action: 'payment.updated',
        resourceType: 'payment',
        resourceId: id,
        ipAddress: ipAddress ?? null,
        userAgent: userAgent ?? null,
        metadata: { before, after, changedFields },
      });
      await queryRunner.manager.save(auditLog);

      await queryRunner.commitTransaction();
      this.logger.info(
        { paymentId: id, changedFields },
        'Payment updated successfully',
      );

      this.paymentSseService.emit(updatedPayment);
      await this.webhooksService
        .dispatchEventToMerchant(actorId, 'payment.updated', {
          paymentId: updatedPayment.id,
          before,
          after,
          changedFields,
        })
        .catch((error: unknown) =>
          this.logger.error(
            { paymentId: id, error },
            'Failed to dispatch payment.updated webhook',
          ),
        );

      return updatedPayment;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(
        `Payment update failed and rolled back: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async getRefunds(paymentId: string): Promise<Refund[]> {
    return await this.refundRepository.find({
      where: { paymentId },
      order: { createdAt: 'DESC' },
    });
  }

  async addPaymentNote(
    paymentId: string,
    merchantId: string,
    body: string,
  ): Promise<PaymentNote> {
    await this.findPaymentForMerchant(paymentId, merchantId);
    const notes = this.dataSource.getRepository(PaymentNote);
    const note = notes.create({ paymentId, authorId: merchantId, body });
    return notes.save(note);
  }

  async getPaymentNotes(
    paymentId: string,
    merchantId: string,
  ): Promise<PaymentNote[]> {
    await this.findPaymentForMerchant(paymentId, merchantId);
    return this.dataSource.getRepository(PaymentNote).find({
      where: { paymentId },
      order: { createdAt: 'ASC' },
    });
  }

  private async findPaymentForMerchant(
    paymentId: string,
    merchantId: string,
  ): Promise<Payment> {
    const payment = await this.paymentRepository.findOneBy({
      id: paymentId,
      merchantId,
    });
    if (!payment) {
      throw new NotFoundException(`Payment with ID ${paymentId} not found`);
    }
    return payment;
  }

  async listRefunds(
    merchantId: string,
    dto: GetRefundsDto,
  ): Promise<PaginatedResult<Refund>> {
    const query = this.refundRepository
      .createQueryBuilder('refund')
      .innerJoin(Payment, 'payment', 'payment.id = refund."paymentId"')
      .where('payment.merchantId = :merchantId', { merchantId });

    if (dto.status) {
      query.andWhere('refund.status = :status', { status: dto.status });
    }
    if (dto.from) {
      query.andWhere('refund."createdAt" >= :from', { from: dto.from });
    }
    if (dto.to) {
      query.andWhere('refund."createdAt" <= :to', { to: dto.to });
    }
    if (dto.paymentId) {
      query.andWhere('refund."paymentId" = :paymentId', {
        paymentId: dto.paymentId,
      });
    }
    if (dto.reasonCode) {
      query.andWhere('refund."reasonCode" = :reasonCode', {
        reasonCode: dto.reasonCode,
      });
    }

    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    query
      .orderBy('refund."createdAt"', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [data, total] = await query.getManyAndCount();
    return { data, total, page, limit };
  }

  async getRefundReport(from?: string, to?: string) {
    const query = this.refundRepository
      .createQueryBuilder('refund')
      .innerJoin(Payment, 'payment', 'payment.id = refund."paymentId"')
      .select('refund."reasonCode"', 'reasonCode')
      .addSelect('payment.currency', 'currency')
      .addSelect('COUNT(refund.id)', 'count')
      .addSelect('COALESCE(SUM(refund.amount), 0)', 'amount')
      .groupBy('refund."reasonCode"')
      .addGroupBy('payment.currency')
      .orderBy('refund."reasonCode"', 'ASC')
      .addOrderBy('payment.currency', 'ASC');

    if (from) {
      query.andWhere('refund."createdAt" >= :from', { from });
    }
    if (to) {
      query.andWhere('refund."createdAt" <= :to', { to });
    }

    const rows = await query.getRawMany<{
      reasonCode: RefundReasonCode;
      currency: string;
      count: string;
      amount: string;
    }>();

    return rows.map((row) => ({
      reasonCode: row.reasonCode,
      currency: row.currency,
      count: Number(row.count),
      amount: Number(Number(row.amount).toFixed(2)),
    }));
  }

  /**
   * Returns a chronological timeline of events for a given payment.
   * Aggregates data from the payment itself, its refunds, and disputes,
   * sorted by timestamp ascending.
   */
  async getTimeline(
    paymentId: string,
    merchantId?: string,
  ): Promise<PaymentTimelineEvent[]> {
    const payment = merchantId
      ? await this.findPaymentForMerchant(paymentId, merchantId)
      : await this.findOne(paymentId);
    const events: PaymentTimelineEvent[] = [];

    // Payment creation event
    events.push({
      type: 'payment.created',
      timestamp: payment.createdAt,
      data: {
        amount: payment.amount,
        currency: payment.currency,
        status: PaymentStatus.PENDING,
        description: payment.description,
      },
    });

    // Status changes reflect via updatedAt. A non-status field update also
    // changes updatedAt, so PENDING alone must not imply a status transition.
    if (
      payment.updatedAt &&
      payment.updatedAt > payment.createdAt &&
      payment.status !== PaymentStatus.PENDING
    ) {
      events.push({
        type: 'payment.status_updated',
        timestamp: payment.updatedAt,
        data: { status: payment.status },
      });
    }

    // Mutable-field updates are persisted as audit records and projected into
    // the payment timeline with their before/after snapshots.
    const auditLogRepository = this.dataSource.getRepository(AuditLog);
    const updateAuditLogs = await auditLogRepository.find({
      where: {
        action: 'payment.updated',
        resourceType: 'payment',
        resourceId: paymentId,
      },
      order: { timestamp: 'ASC' },
    });
    for (const auditLog of updateAuditLogs) {
      const metadata = auditLog.metadata as {
        before?: Record<string, unknown>;
        after?: Record<string, unknown>;
        changedFields?: string[];
      } | null;
      events.push({
        type: 'payment.updated',
        timestamp: auditLog.timestamp,
        data: {
          before: metadata?.before ?? null,
          after: metadata?.after ?? null,
          changedFields: metadata?.changedFields ?? [],
        },
      });
    }

    // Cancellation event
    if (payment.cancelledAt) {
      events.push({
        type: 'payment.cancelled',
        timestamp: payment.cancelledAt,
        data: { cancelledAt: payment.cancelledAt },
      });
    }

    // Expiry event
    if (payment.expiredAt) {
      events.push({
        type: 'payment.expired',
        timestamp: payment.expiredAt,
        data: { expiredAt: payment.expiredAt },
      });
    }

    // Refund events
    const refunds = await this.refundRepository.find({
      where: { paymentId },
      order: { createdAt: 'ASC' },
    });
    for (const refund of refunds) {
      events.push({
        type: 'refund.created',
        timestamp: refund.createdAt,
        data: {
          refundId: refund.id,
          amount: refund.amount,
          reason: refund.reason,
          initiatedBy: refund.initiatedBy,
          status: refund.status,
          stellarTransactionHash: refund.stellarTransactionHash,
          claimableBalanceId: refund.claimableBalanceId,
        },
      });
    }

    const notes = await this.dataSource.getRepository(PaymentNote).find({
      where: { paymentId },
      order: { createdAt: 'ASC' },
    });
    for (const note of notes) {
      events.push({
        type: 'payment.note_added',
        timestamp: note.createdAt,
        data: {
          noteId: note.id,
          authorId: note.authorId,
          body: note.body,
        },
      });
    }

    const splits = await this.paymentSplitRepository.find({
      where: { paymentId },
      order: { createdAt: 'ASC' },
    });
    for (const split of splits) {
      events.push({
        type: 'payment.split_processed',
        timestamp: split.updatedAt,
        data: {
          splitId: split.id,
          status: split.status,
          amount: split.amount,
          recipientAddress: split.recipientAddress,
          stellarTransactionHash: split.stellarTransactionHash,
          claimableBalanceId: split.claimableBalanceId,
        },
      });
    }

    // Dispute events
    const disputes = await this.disputeRepository.find({
      where: { paymentId },
      order: { createdAt: 'ASC' },
    });
    for (const dispute of disputes) {
      events.push({
        type: 'dispute.opened',
        timestamp: dispute.createdAt,
        data: {
          disputeId: dispute.id,
          reason: dispute.reason,
          description: dispute.description,
          disputedAmount: dispute.disputedAmount,
          status: dispute.status,
        },
      });

      if (dispute.resolvedAt) {
        events.push({
          type: 'dispute.resolved',
          timestamp: dispute.resolvedAt,
          data: {
            disputeId: dispute.id,
            resolutionNotes: dispute.resolutionNotes,
            resolvedBy: dispute.resolvedBy,
          },
        });
      }

      if (dispute.closedAt) {
        events.push({
          type: 'dispute.closed',
          timestamp: dispute.closedAt,
          data: {
            disputeId: dispute.id,
          },
        });
      }
    }

    // Sort all events chronologically
    events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    return events;
  }

  async refund(
    id: string,
    refundDto: RefundPaymentDto,
    initiatedBy?: string,
  ): Promise<{ payment: Payment; refund: Refund }> {
    const queryRunner = this.dataSource.createQueryRunner();
    let attemptedRefund: Refund | null = null;
    let refundPayment: Payment | null = null;

    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();

      const payment = await queryRunner.manager.findOneBy(Payment, { id });

      if (!payment) {
        throw new NotFoundException(`Payment with ID ${id} not found`);
      }
      refundPayment = payment;

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

      const maxRefundsPerPayment = Number(
        this.configService.get<string>(
          'PAYMENT_MAX_REFUNDS_PER_PAYMENT',
          String(DEFAULT_MAX_REFUNDS_PER_PAYMENT),
        ),
      );

      if (maxRefundsPerPayment > 0) {
        const existingRefundCount = await queryRunner.manager.count(Refund, {
          where: { paymentId: id },
        });

        if (existingRefundCount >= maxRefundsPerPayment) {
          throw new ConflictException(
            `Payment ${id} has reached the maximum of ${maxRefundsPerPayment} refunds per payment`,
          );
        }
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

      // Check maker-checker approval threshold
      if (payment.merchantId) {
        const settings = await queryRunner.manager.findOneBy(MerchantSettings, {
          merchantId: payment.merchantId,
        });
        const threshold = settings?.refundApprovalThresholds?.[payment.currency];
        if (threshold !== undefined && refundAmount > threshold) {
          const pendingRefund = queryRunner.manager.create(Refund, {
            paymentId: id,
            amount: refundAmount,
            reasonCode: refundDto.reasonCode,
            reason: refundDto.reason,
            initiatedBy: initiatedBy ?? null,
            status: RefundStatus.PENDING_APPROVAL,
            expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
          });
          const savedPending = await queryRunner.manager.save(pendingRefund);
          await queryRunner.commitTransaction();
          this.logger.info(
            `Refund ${savedPending.id} queued for approval (amount ${refundAmount} > threshold ${threshold} ${payment.currency})`,
          );
          // Notify merchant that approval is required
          if (payment.merchantEmail) {
            await this.emailNotificationService
              .sendRefundApprovalRequested(
                payment.merchantEmail,
                payment.id,
                savedPending.id,
                String(refundAmount),
                payment.currency,
                initiatedBy ?? null,
              )
              .catch((err) =>
                this.logger.error({ err }, 'Failed to send refund approval email'),
              );
          }
          return { payment, refund: savedPending };
        }
      }

      const refund = queryRunner.manager.create(Refund, {
        paymentId: id,
        amount: refundAmount,
        reasonCode: refundDto.reasonCode,
        reason: refundDto.reason,
        initiatedBy: initiatedBy ?? null,
        status: RefundStatus.EXECUTED,
      });
      attemptedRefund = refund;

      const savedRefund = await queryRunner.manager.save(refund);

      payment.refundedAmount =
        Number(payment.refundedAmount || 0) + refundAmount;

      if (payment.refundedAmount >= Number(payment.amount)) {
        payment.status = PaymentStatus.REFUNDED;
      } else {
        payment.status = PaymentStatus.PARTIALLY_REFUNDED;
      }

      const updatedPayment = await queryRunner.manager.save(payment);

      if (payment.settlementId) {
        // settlementId is only ever stamped onto payments that have a merchantId
        // (settlement processing groups by merchantId), so it is non-null here.
        const adjustment = queryRunner.manager.create(SettlementAdjustment, {
          settlementId: payment.settlementId,
          refundId: savedRefund.id,
          paymentId: payment.id,
          merchantId: payment.merchantId as string,
          amount: -refundAmount,
          currency: payment.currency,
        });
        await queryRunner.manager.save(adjustment);
        this.logger.info(
          `Settlement adjustment recorded: settlement ${payment.settlementId} for refund ${savedRefund.id}, amount: ${-refundAmount}`,
        );
      }

      await this.appendRefund(
        queryRunner.manager,
        payment,
        savedRefund.id,
        refundAmount,
      );
      await queryRunner.commitTransaction();

      if (refundDto.stellarDestination) {
        try {
          const stellarResult = await this.stellarService.sendPayout({
            destination: refundDto.stellarDestination,
            amount: String(refundAmount),
            assetCode: payment.currency,
            merchantId: payment.merchantId ?? undefined,
          });
          savedRefund.status = stellarResult?.status === 'claimable'
            ? RefundStatus.CLAIMABLE
            : stellarResult?.status === 'pending_signatures'
              ? RefundStatus.PENDING
              : RefundStatus.COMPLETED;
          savedRefund.stellarTransactionHash = stellarResult?.hash ?? null;
          savedRefund.claimableBalanceId = stellarResult?.claimableBalanceId ?? null;
          await this.refundRepository.save(savedRefund);
        } catch (stellarError) {
          savedRefund.status = RefundStatus.FAILED;
          await this.refundRepository.save(savedRefund);
          this.logger.error(
            `Stellar refund transfer failed for refund ${savedRefund.id}: ${stellarError instanceof Error ? stellarError.message : String(stellarError)}`,
          );
        }
      }

      this.logger.info(
        `Refund processed: ${savedRefund.id} for payment ${id}, amount: ${refundAmount}`,
      );

      this.paymentSseService.emit(updatedPayment);

      await this.sendRefundNotifications(updatedPayment, savedRefund);
      await this.dispatchRefundWebhook(updatedPayment, savedRefund, 'refund.issued');

      return { payment: updatedPayment, refund: savedRefund };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      if (attemptedRefund && refundPayment?.merchantId) {
        await this.dispatchRefundWebhook(
          refundPayment,
          attemptedRefund,
          'refund.failed',
          error,
        );
      }
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

      const payment = await queryRunner.manager.findOne(Payment, {
        where: { id: webhookDto.paymentId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!payment) {
        throw new NotFoundException(
          `Payment with ID ${webhookDto.paymentId} not found`,
        );
      }

      const previousStatus = payment.status;
      payment.status = webhookDto.status;
      if (webhookDto.externalReference) {
        payment.externalReference = webhookDto.externalReference;
      }

      if (previousStatus !== payment.status) {
        await this.settleCouponReservation(queryRunner.manager, payment, payment.status);
      }

      const updatedPayment = await queryRunner.manager.save(payment);

      if (previousStatus !== PaymentStatus.COMPLETED) {
        if (updatedPayment.status === PaymentStatus.COMPLETED) {
          await this.appendPaymentCompletion(
            queryRunner.manager,
            updatedPayment,
          );
          if (updatedPayment.invoiceId) {
            await queryRunner.manager
              .createQueryBuilder()
              .update(Invoice)
              .set({ status: InvoiceStatus.PAID, paymentId: updatedPayment.id })
              .where('id = :invoiceId', { invoiceId: updatedPayment.invoiceId })
              .andWhere('status IN (:...statuses)', {
                statuses: [InvoiceStatus.OPEN, InvoiceStatus.OVERDUE],
              })
              .execute();
          }
        }
      }

      await queryRunner.commitTransaction();
      this.logger.info(
        `Webhook processed successfully for payment: ${updatedPayment.id}`,
      );

      this.paymentSseService.emit(updatedPayment);

      if (updatedPayment.status === PaymentStatus.COMPLETED) {
        await this.sendPaymentConfirmedNotifications(updatedPayment);
        await this.processSplitsForPayment(updatedPayment);
      }

      if (
        updatedPayment.status === PaymentStatus.COMPLETED &&
        previousStatus !== PaymentStatus.COMPLETED &&
        updatedPayment.paymentLinkId
      ) {
        await this.paymentLinksService.incrementCompletions(
          updatedPayment.paymentLinkId,
        );
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

  private async settleCouponReservation(
    manager: EntityManager,
    payment: Payment,
    status: PaymentStatus,
  ): Promise<void> {
    if (!payment.couponId || !payment.couponRedemptionReserved) return;
    if (![PaymentStatus.COMPLETED, PaymentStatus.FAILED, PaymentStatus.CANCELLED, PaymentStatus.EXPIRED].includes(status)) return;

    const couponUpdate = manager
      .createQueryBuilder()
      .update(Coupon)
      .set({
        reservedRedemptions: () => '"reservedRedemptions" - 1',
        ...(status === PaymentStatus.COMPLETED
          ? { redemptions: () => '"redemptions" + 1' }
          : {}),
      })
      .where('id = :couponId', { couponId: payment.couponId })
      .andWhere('"reservedRedemptions" > 0');
    const result = await couponUpdate.execute();
    if (result.affected !== 1) {
      throw new ConflictException('Coupon redemption reservation is no longer available');
    }
    payment.couponRedemptionReserved = false;
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
    const updatedPayment = await this.dataSource.transaction(async (manager) => {
      const payment = await manager.findOne(Payment, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!payment) throw new NotFoundException(`Payment with ID ${id} not found`);
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
      await this.settleCouponReservation(manager, payment, payment.status);
      return manager.save(payment);
    });
    this.logger.info(
      { paymentId: id, cancelledAt: updatedPayment.cancelledAt },
      'Payment cancelled successfully',
    );

    this.paymentSseService.emit(updatedPayment);

    if (updatedPayment.merchantId) {
      await this.webhooksService
        .dispatchEventToMerchant(updatedPayment.merchantId, 'payment.cancelled', {
          paymentId: updatedPayment.id,
          amount: updatedPayment.amount,
          currency: updatedPayment.currency,
          cancelledAt: updatedPayment.cancelledAt,
        })
        .catch((e) =>
          this.logger.error('Failed to dispatch payment.cancelled webhook', e),
        );
    }

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
   * Processes payments in bounded batches to prevent unbounded processing under high load.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async expirePendingPayments(): Promise<void> {
    const batchSize = this.configService.get<number>(
      'PAYMENT_EXPIRY_BATCH_SIZE',
      100,
    );

    const expiredPayments = await this.paymentRepository.find({
      where: {
        status: PaymentStatus.PENDING,
        expiresAt: LessThanOrEqual(new Date()),
      },
      take: batchSize, // Limit batch size to prevent unbounded processing
      order: {
        expiresAt: 'ASC', // Process oldest first
      },
    });

    if (expiredPayments.length === 0) {
      return;
    }

    this.logger.info(
      `Processing ${expiredPayments.length} expired payments (batch limit: ${batchSize})`,
    );

    // Process payments in parallel for better performance
    const results = await Promise.allSettled(
      expiredPayments.map((payment) => this.expirePayment(payment)),
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;

    if (failed > 0) {
      this.logger.warn(
        `Expired ${succeeded} payments successfully, ${failed} failed`,
      );
    } else {
      this.logger.info(`Successfully expired ${succeeded} payments`);
    }

    // If we processed a full batch, there might be more - log a warning
    if (expiredPayments.length === batchSize) {
      this.logger.warn(
        `Processed full batch of ${batchSize} payments. More expired payments may be pending.`,
      );
    }
  }

  private async expirePayment(payment: Payment): Promise<void> {
    const updatedPayment = await this.dataSource.transaction(async (manager) => {
      const current = await manager.findOne(Payment, {
        where: { id: payment.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!current || current.status !== PaymentStatus.PENDING) return null;
      current.status = PaymentStatus.EXPIRED;
      current.expiredAt = new Date();
      await this.settleCouponReservation(manager, current, current.status);
      return manager.save(current);
    });
    if (!updatedPayment) return;
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
    let claimableCount = 0;

    for (const split of splits) {
      try {
        const result = await this.stellarService.sendPayout({
          destination: split.recipientAddress,
          amount: String(split.amount),
          assetCode: payment.currency,
          merchantId: payment.merchantId ?? undefined,
        });

        split.status = result?.status === 'claimable'
          ? PaymentSplitStatus.CLAIMABLE
          : PaymentSplitStatus.COMPLETED;
        split.claimableBalanceId = result?.claimableBalanceId ?? null;
        if (split.status === PaymentSplitStatus.CLAIMABLE) claimableCount += 1;
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
            claimableSplits: claimableCount,
            splits: splits.map((split) => ({
              splitId: split.id,
              status: split.status,
              claimableBalanceId: split.claimableBalanceId,
              stellarTransactionHash: split.stellarTransactionHash,
            })),
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
          payment.payerLocale,
        )
        .catch(() => {});
    }
  }

  private async appendPaymentCompletion(
    manager: EntityManager,
    payment: Payment,
  ): Promise<void> {
    if (!payment.merchantId) return;
    const grossValue = Number(payment.amount);
    if (!Number.isFinite(grossValue) || grossValue <= 0) return;
    const gross = Number(grossValue.toFixed(2));
    const availableValue = Number(payment.netAmount ?? gross);
    const available = Number.isFinite(availableValue)
      ? Number(availableValue.toFixed(2))
      : gross;
    const fee = gross - available;
    const lines = [
      {
        merchantId: payment.merchantId,
        currency: payment.currency,
        account: LedgerAccount.PENDING,
        amount: -gross,
        referenceType: LedgerReferenceType.PAYMENT,
        referenceId: payment.id,
      },
    ];

    if (available !== 0) {
      lines.push({
        merchantId: payment.merchantId,
        currency: payment.currency,
        account: LedgerAccount.AVAILABLE,
        amount: available,
        referenceType: LedgerReferenceType.PAYMENT,
        referenceId: payment.id,
      });
    }
    if (fee !== 0) {
      lines.push({
        merchantId: payment.merchantId,
        currency: payment.currency,
        account: LedgerAccount.FEES,
        amount: fee,
        referenceType: LedgerReferenceType.FEE,
        referenceId: payment.id,
      });
    }

    await appendLedgerTransaction(manager, { lines });
  }

  private async appendRefund(
    manager: EntityManager,
    payment: Payment,
    refundId: string,
    amount: number,
  ): Promise<void> {
    if (!payment.merchantId || !Number.isFinite(amount) || amount <= 0) return;
    const ledgerAmount = Number(amount.toFixed(2));
    if (ledgerAmount <= 0) return;
    const offsetAccount = payment.settlementId
      ? LedgerAccount.RESERVE
      : LedgerAccount.PAYOUT;

    await appendLedgerTransaction(manager, {
      lines: [
        {
          merchantId: payment.merchantId,
          currency: payment.currency,
          account: LedgerAccount.AVAILABLE,
          amount: -ledgerAmount,
          referenceType: LedgerReferenceType.REFUND,
          referenceId: refundId,
        },
        {
          merchantId: payment.merchantId,
          currency: payment.currency,
          account: offsetAccount,
          amount: ledgerAmount,
          referenceType: LedgerReferenceType.REFUND,
          referenceId: refundId,
        },
      ],
    });
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
          payment.payerLocale,
        )
        .catch(() => {});
    }
  }

  // ─── Sandbox simulation ────────────────────────────────────────────────────

  /**
   * Forces a payment into a terminal state for sandbox/testnet integration testing.
   * Runs the exact same side-effect chain as a real status transition:
   * SSE emit → email notifications → split processing → merchant webhooks.
   *
   * Only callable when STELLAR_NETWORK !== 'PUBLIC'.
   */
  async simulate(
    paymentId: string,
    outcome: import('./dto/simulate-payment.dto').SimulateOutcome,
    partialAmount?: number,
  ): Promise<Payment> {
    const payment = await this.paymentRepository.findOneBy({ id: paymentId });
    if (!payment) {
      throw new NotFoundException(`Payment with ID ${paymentId} not found`);
    }

    const terminalStates: PaymentStatus[] = [
      PaymentStatus.COMPLETED,
      PaymentStatus.FAILED,
      PaymentStatus.CANCELLED,
      PaymentStatus.REFUNDED,
      PaymentStatus.PARTIALLY_REFUNDED,
      PaymentStatus.EXPIRED,
      PaymentStatus.PARTIALLY_COMPLETED,
    ];

    if (terminalStates.includes(payment.status)) {
      throw new ConflictException(
        `Cannot simulate outcome on payment already in terminal state: ${payment.status}`,
      );
    }

    // Stamp metadata so consumers can identify simulated transitions
    payment.metadata = {
      ...(payment.metadata ?? {}),
      simulated: 'true',
    };

    const previousStatus = payment.status;

    switch (outcome) {
      case 'COMPLETED': {
        payment.status = PaymentStatus.COMPLETED;
        break;
      }
      case 'FAILED': {
        payment.status = PaymentStatus.FAILED;
        break;
      }
      case 'EXPIRED': {
        payment.status = PaymentStatus.EXPIRED;
        payment.expiredAt = new Date();
        break;
      }
      case 'PARTIALLY_COMPLETED': {
        payment.status = PaymentStatus.PARTIALLY_COMPLETED;
        if (partialAmount !== undefined) {
          payment.amount = partialAmount;
          const fee = await this.calculateFee(
            payment.merchantId ?? undefined,
            partialAmount,
          );
          payment.feeAmount = fee.feeAmount;
          payment.netAmount = fee.netAmount;
        }
        break;
      }
    }

    const updated = await this.paymentRepository.save(payment);

    if (
      previousStatus !== updated.status &&
      [PaymentStatus.COMPLETED, PaymentStatus.FAILED, PaymentStatus.EXPIRED].includes(updated.status) &&
      updated.couponRedemptionReserved
    ) {
      await this.dataSource.transaction(async (manager) => {
        const current = await manager.findOne(Payment, {
          where: { id: updated.id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!current) return;
        await this.settleCouponReservation(manager, current, updated.status);
        await manager.save(current);
      });
      updated.couponRedemptionReserved = false;
    }

    this.logger.info(
      { paymentId, outcome, previousStatus },
      'Payment simulation applied',
    );

    // ── Side effects (same as real status transitions) ─────────────────────

    this.paymentSseService.emit(updated);

    if (
      updated.status === PaymentStatus.COMPLETED ||
      updated.status === PaymentStatus.PARTIALLY_COMPLETED
    ) {
      await this.sendPaymentConfirmedNotifications(updated);
      await this.processSplitsForPayment(updated);
    }

    if (
      updated.status === PaymentStatus.COMPLETED &&
      previousStatus !== PaymentStatus.COMPLETED &&
      updated.paymentLinkId
    ) {
      await this.paymentLinksService.incrementCompletions(updated.paymentLinkId);
    }

    if (updated.status === PaymentStatus.COMPLETED && updated.invoiceId) {
      await this.dataSource.transaction((manager) =>
        manager
          .createQueryBuilder()
          .update(Invoice)
          .set({ status: InvoiceStatus.PAID, paymentId: updated.id })
          .where('id = :invoiceId', { invoiceId: updated.invoiceId })
          .andWhere('status IN (:...statuses)', {
            statuses: [InvoiceStatus.OPEN, InvoiceStatus.OVERDUE],
          })
          .execute(),
      );
    }

    const webhookEvent =
      updated.status === PaymentStatus.COMPLETED
        ? 'payment.completed'
        : updated.status === PaymentStatus.FAILED
          ? 'payment.failed'
          : updated.status === PaymentStatus.EXPIRED
            ? 'payment.expired'
            : 'payment.partially_completed';

    if (updated.merchantId) {
      await this.webhooksService
        .dispatchEventToMerchant(updated.merchantId, webhookEvent, {
          paymentId: updated.id,
          amount: updated.amount,
          currency: updated.currency,
          status: updated.status,
          simulated: true,
          ...(updated.expiredAt && { expiredAt: updated.expiredAt }),
        })
        .catch((e) =>
          this.logger.error(
            { paymentId, event: webhookEvent },
            `Failed to dispatch ${webhookEvent} webhook after simulation: ${e?.message}`,
          ),
        );
    }

    return updated;
  }

  private async dispatchRefundWebhook(
    payment: Payment,
    refund: Refund,
    event: 'refund.issued' | 'refund.failed',
    error?: unknown,
  ): Promise<void> {
    if (!payment.merchantId) return;

    await this.webhooksService
      .dispatchEventToMerchant(payment.merchantId, event, {
        payment,
        refund,
        status: event === 'refund.issued' ? 'issued' : 'failed',
        failureReason: error instanceof Error ? error.message : undefined,
        timestamp: new Date().toISOString(),
      })
      .catch((webhookError) => {
        this.logger.error(
          `Failed to dispatch ${event} webhook: ${webhookError instanceof Error ? webhookError.message : 'Unknown error'}`,
        );
      });
  }

  // ── Maker-checker refund approval ─────────────────────────────────────────

  async approveRefund(
    refundId: string,
    approverId: string,
  ): Promise<{ payment: Payment; refund: Refund }> {
    const queryRunner = this.dataSource.createQueryRunner();
    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();

      const refund = await queryRunner.manager.findOneBy(Refund, { id: refundId });
      if (!refund) throw new NotFoundException(`Refund with ID ${refundId} not found`);

      if (refund.status !== RefundStatus.PENDING_APPROVAL) {
        throw new ConflictException(
          `Refund is not pending approval (status: ${refund.status})`,
        );
      }
      if (refund.expiresAt && refund.expiresAt < new Date()) {
        throw new ConflictException('Refund approval window has expired');
      }
      if (refund.initiatedBy === approverId) {
        throw new ForbiddenException('Cannot approve a refund you initiated');
      }

      const payment = await queryRunner.manager.findOneBy(Payment, {
        id: refund.paymentId,
      });
      if (!payment) throw new NotFoundException(`Payment ${refund.paymentId} not found`);

      const refundAmount = Number(refund.amount);
      const remainingAmount = Number(payment.amount) - Number(payment.refundedAmount || 0);
      if (refundAmount > remainingAmount) {
        throw new ConflictException(
          `Refund amount ${refundAmount} exceeds remaining refundable amount ${remainingAmount}`,
        );
      }

      refund.status = RefundStatus.EXECUTED;
      refund.approvedBy = approverId;
      refund.approvedAt = new Date();
      await queryRunner.manager.save(refund);

      payment.refundedAmount = Number(payment.refundedAmount || 0) + refundAmount;
      if (payment.refundedAmount >= Number(payment.amount)) {
        payment.status = PaymentStatus.REFUNDED;
      } else {
        payment.status = PaymentStatus.PARTIALLY_REFUNDED;
      }
      const updatedPayment = await queryRunner.manager.save(payment);

      if (payment.settlementId) {
        const adjustment = queryRunner.manager.create(SettlementAdjustment, {
          settlementId: payment.settlementId,
          refundId: refund.id,
          paymentId: payment.id,
          merchantId: payment.merchantId as string,
          amount: -refundAmount,
          currency: payment.currency,
        });
        await queryRunner.manager.save(adjustment);
      }

      await this.appendRefund(queryRunner.manager, payment, refund.id, refundAmount);
      await queryRunner.commitTransaction();

      this.logger.info(`Refund ${refundId} approved by ${approverId}`);
      this.paymentSseService.emit(updatedPayment);

      await this.auditLogsService
        .record({
          actorId: approverId,
          actorType: 'user',
          action: 'refund.approved',
          resourceType: 'refund',
          resourceId: refundId,
          metadata: { paymentId: payment.id, amount: refundAmount, currency: payment.currency },
        })
        .catch((err) => this.logger.error({ err }, 'Failed to record refund approval audit log'));

      await this.sendRefundNotifications(updatedPayment, refund);
      await this.dispatchRefundWebhook(updatedPayment, refund, 'refund.issued');

      if (payment.merchantEmail) {
        await this.emailNotificationService
          .sendRefundApprovalOutcome(
            payment.merchantEmail,
            payment.id,
            refund.id,
            String(refundAmount),
            payment.currency,
            true,
          )
          .catch((err) => this.logger.error({ err }, 'Failed to send refund approved email'));
      }

      return { payment: updatedPayment, refund };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(
        `Refund approval failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async rejectRefund(
    refundId: string,
    rejecterId: string,
    dto: RejectRefundDto,
  ): Promise<Refund> {
    const refund = await this.refundRepository.findOneBy({ id: refundId });
    if (!refund) throw new NotFoundException(`Refund with ID ${refundId} not found`);

    if (refund.status !== RefundStatus.PENDING_APPROVAL) {
      throw new ConflictException(
        `Refund is not pending approval (status: ${refund.status})`,
      );
    }
    if (refund.expiresAt && refund.expiresAt < new Date()) {
      throw new ConflictException('Refund approval window has expired');
    }

    refund.status = RefundStatus.REJECTED;
    refund.rejectedBy = rejecterId;
    refund.rejectedAt = new Date();
    refund.rejectionReason = dto.reason ?? null;
    const saved = await this.refundRepository.save(refund);

    this.logger.info(`Refund ${refundId} rejected by ${rejecterId}`);

    await this.auditLogsService
      .record({
        actorId: rejecterId,
        actorType: 'user',
        action: 'refund.rejected',
        resourceType: 'refund',
        resourceId: refundId,
        metadata: { reason: dto.reason ?? null },
      })
      .catch((err) => this.logger.error({ err }, 'Failed to record refund rejection audit log'));

    const payment = await this.paymentRepository.findOneBy({ id: refund.paymentId });
    if (payment?.merchantEmail) {
      await this.emailNotificationService
        .sendRefundApprovalOutcome(
          payment.merchantEmail,
          payment.id,
          refund.id,
          String(refund.amount),
          payment.currency,
          false,
          dto.reason,
        )
        .catch((err) => this.logger.error({ err }, 'Failed to send refund rejected email'));
    }

    return saved;
  }

  async cancelRefund(
    refundId: string,
    actorId: string,
  ): Promise<{ payment: Payment; refund: Refund }> {
    const queryRunner = this.dataSource.createQueryRunner();
    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();

      const refund = await queryRunner.manager.findOneBy(Refund, { id: refundId });
      if (!refund) {
        throw new NotFoundException(`Refund with ID ${refundId} not found`);
      }

      const preSubmissionStatuses: RefundStatus[] = [
        RefundStatus.PENDING_APPROVAL,
        RefundStatus.PENDING,
      ];
      if (
        !preSubmissionStatuses.includes(refund.status) ||
        Boolean(refund.stellarTransactionHash)
      ) {
        throw new ConflictException(
          `Refund cannot be cancelled from status ${refund.status}`,
        );
      }

      const payment = await queryRunner.manager.findOneBy(Payment, {
        id: refund.paymentId,
      });
      if (!payment) {
        throw new NotFoundException(`Payment ${refund.paymentId} not found`);
      }

      const refundAmount = Number(refund.amount);
      const currentRefunded = Number(payment.refundedAmount || 0);
      if (currentRefunded > 0) {
        payment.refundedAmount = Math.max(0, currentRefunded - refundAmount);
        if (
          payment.status === PaymentStatus.REFUNDED ||
          payment.status === PaymentStatus.PARTIALLY_REFUNDED
        ) {
          payment.status =
            payment.refundedAmount > 0
              ? PaymentStatus.PARTIALLY_REFUNDED
              : PaymentStatus.COMPLETED;
        }
      }
      const updatedPayment = await queryRunner.manager.save(payment);

      refund.status = RefundStatus.CANCELLED;
      refund.cancelledBy = actorId;
      refund.cancelledAt = new Date();
      const savedRefund = await queryRunner.manager.save(refund);

      await queryRunner.commitTransaction();

      this.logger.info(`Refund ${refundId} cancelled by ${actorId}`);

      await this.auditLogsService
        .record({
          actorId,
          actorType: 'user',
          action: 'refund.cancelled',
          resourceType: 'refund',
          resourceId: refundId,
          metadata: {
            paymentId: payment.id,
            amount: refundAmount,
            currency: payment.currency,
          },
        })
        .catch((err) =>
          this.logger.error({ err }, 'Failed to record refund cancellation audit log'),
        );

      return { payment: updatedPayment, refund: savedRefund };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async expirePendingRefundApprovals(): Promise<void> {
    const result = await this.refundRepository
      .createQueryBuilder()
      .update(Refund)
      .set({ status: RefundStatus.EXPIRED })
      .where('status = :status', { status: RefundStatus.PENDING_APPROVAL })
      .andWhere('"expiresAt" < :now', { now: new Date() })
      .execute();

    if (result.affected && result.affected > 0) {
      this.logger.info(`Expired ${result.affected} pending refund approval(s)`);
    }
  }
}
