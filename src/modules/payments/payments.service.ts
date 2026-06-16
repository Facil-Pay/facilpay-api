import { Injectable, NotFoundException, ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource, Repository, LessThanOrEqual, MoreThanOrEqual, Like, Between, MoreThan } from 'typeorm';
import { Payment, PaymentStatus } from './payment.entity';
import { Refund } from './refund.entity';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { PaymentWebhookDto } from './dto/payment-webhook.dto';
import { GetPaymentsDto } from './dto/get-payments.dto';
import { AppLogger } from '../logger/logger.service';
import { Logger } from 'pino';
import { IdempotencyService } from './idempotency.service';

@Injectable()
export class PaymentsService {
  private readonly logger: Logger;
  private readonly minAmount: number;
  private readonly maxAmount: number;
  private readonly dailyLimitPerUser: number;

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    @InjectRepository(Refund)
    private readonly refundRepository: Repository<Refund>,
    private readonly dataSource: DataSource,
    appLogger: AppLogger,
    private readonly idempotencyService: IdempotencyService,
    private readonly configService: ConfigService,
  ) {
    this.logger = appLogger.child({ module: PaymentsService.name });
    this.minAmount = this.configService.get<number>('PAYMENT_MIN_AMOUNT', 0.01);
    this.maxAmount = this.configService.get<number>('PAYMENT_MAX_AMOUNT', Infinity);
    this.dailyLimitPerUser = this.configService.get<number>('PAYMENT_DAILY_LIMIT_PER_USER', Infinity);
  }

  private async checkPaymentLimits(amount: number, userId?: string): Promise<void> {
    if (amount < this.minAmount) {
      throw new UnprocessableEntityException(
        `Payment amount ${amount} is below the minimum allowed amount of ${this.minAmount}`,
      );
    }
    if (amount > this.maxAmount) {
      throw new UnprocessableEntityException(
        `Payment amount ${amount} exceeds the maximum allowed amount of ${this.maxAmount}`,
      );
    }

    if (userId && isFinite(this.dailyLimitPerUser)) {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);

      const result = await this.paymentRepository
        .createQueryBuilder('p')
        .select('COALESCE(SUM(p.amount), 0)', 'total')
        .where('p.userId = :userId', { userId })
        .andWhere('p.createdAt >= :startOfDay', { startOfDay })
        .andWhere('p.status NOT IN (:...excluded)', {
          excluded: [PaymentStatus.FAILED, PaymentStatus.CANCELLED],
        })
        .getRawOne<{ total: string }>();

      const dailySpend = Number(result?.total ?? 0);
      if (dailySpend + amount > this.dailyLimitPerUser) {
        throw new UnprocessableEntityException(
          `This payment would exceed your daily limit of ${this.dailyLimitPerUser}. ` +
          `Current daily spend: ${dailySpend.toFixed(2)}`,
        );
      }
    }
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
    idempotencyKey?: string,
    userId?: string,
  ): Promise<Payment> {
    await this.checkPaymentLimits(createPaymentDto.amount, userId);

    // Check for existing idempotency key
    if (idempotencyKey) {
      const cachedResponse = await this.idempotencyService.checkIdempotencyKey(
        idempotencyKey,
        createPaymentDto as unknown as Record<string, unknown>,
      );
      if (cachedResponse) {
        return cachedResponse.responseBody as unknown as Payment;
      }
    }

    const queryRunner = this.dataSource.createQueryRunner();

    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();

      this.logger.debug(
        `Starting payment creation transaction for amount: ${createPaymentDto.amount}`,
      );

      const payment = queryRunner.manager.create(Payment, {
        ...createPaymentDto,
        status: PaymentStatus.PENDING,
        userId: userId ?? null,
      });

      const savedPayment = await queryRunner.manager.save(payment);

      await queryRunner.commitTransaction();
      this.logger.info(`Payment created successfully: ${savedPayment.id}`);

      // Store idempotency key after successful creation
      if (idempotencyKey) {
        await this.idempotencyService.storeIdempotencyKey(
          idempotencyKey,
          createPaymentDto as unknown as Record<string, unknown>,
          savedPayment as unknown as Record<string, unknown>,
          201,
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

      const payments = createPaymentDtos.map((createPaymentDto) =>
        queryRunner.manager.create(Payment, {
          ...createPaymentDto,
          status: PaymentStatus.PENDING,
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

  async findAll(getPaymentsDto: GetPaymentsDto): Promise<Payment[]> {
    const query = this.paymentRepository.createQueryBuilder('payment');

    // Apply filters - all conditions use AND logic
    if (getPaymentsDto.status) {
      query.andWhere('payment.status = :status', { status: getPaymentsDto.status });
    }

    if (getPaymentsDto.currency) {
      query.andWhere('payment.currency = :currency', { currency: getPaymentsDto.currency });
    }

    if (getPaymentsDto.minAmount !== undefined) {
      query.andWhere('payment.amount >= :minAmount', { minAmount: getPaymentsDto.minAmount });
    }

    if (getPaymentsDto.maxAmount !== undefined) {
      query.andWhere('payment.amount <= :maxAmount', { maxAmount: getPaymentsDto.maxAmount });
    }

    if (getPaymentsDto.from) {
      query.andWhere('payment.createdAt >= :fromDate', { fromDate: getPaymentsDto.from });
    }

    if (getPaymentsDto.to) {
      query.andWhere('payment.createdAt <= :toDate', { toDate: getPaymentsDto.to });
    }

    if (getPaymentsDto.search) {
      // Free-text search against description and externalReference
      const searchTerm = `%${getPaymentsDto.search}%`;
      query.andWhere(
        '(payment.description ILIKE :search OR payment.externalReference ILIKE :search)',
        { search: searchTerm },
      );
    }

    // Apply pagination
    const skip = ((getPaymentsDto.page || 1) - 1) * (getPaymentsDto.limit || 20);
    query.skip(skip).take(getPaymentsDto.limit || 20);

    // Order by creation date (newest first)
    query.orderBy('payment.createdAt', 'DESC');

    return await query.getMany();
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
      });

      const savedRefund = await queryRunner.manager.save(refund);

      payment.refundedAmount = Number(payment.refundedAmount || 0) + refundAmount;

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

    return updatedPayment;
  }
}
