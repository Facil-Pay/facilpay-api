import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  RecurringPayment,
  RecurringPaymentInterval,
  RecurringPaymentStatus,
} from './recurring-payment.entity';
import { CreateRecurringPaymentDto } from './dto/create-recurring-payment.dto';
import { PaymentsService } from './payments.service';
import { IdempotencyService } from './idempotency.service';
import { AppLogger } from '../logger/logger.service';
import { Logger } from 'pino';

@Injectable()
export class RecurringPaymentsService {
  private readonly logger: Logger;

  constructor(
    @InjectRepository(RecurringPayment)
    private readonly recurringPaymentRepository: Repository<RecurringPayment>,
    private readonly paymentsService: PaymentsService,
    private readonly idempotencyService: IdempotencyService,
    appLogger: AppLogger,
  ) {
    this.logger = appLogger.child({ module: RecurringPaymentsService.name });
  }

  async create(
    dto: CreateRecurringPaymentDto,
    createdBy: string,
  ): Promise<RecurringPayment> {
    const plan = this.recurringPaymentRepository.create({
      amount: dto.amount,
      currency: dto.currency,
      interval: dto.interval,
      description: dto.description ?? null,
      merchantId: dto.merchantId ?? null,
      merchantEmail: dto.merchantEmail ?? null,
      payerEmail: dto.payerEmail ?? null,
      callbackUrl: dto.callbackUrl ?? null,
      metadata: dto.metadata ?? null,
      createdBy,
      status: RecurringPaymentStatus.ACTIVE,
      nextRunAt: dto.startAt ? new Date(dto.startAt) : new Date(),
    });

    return this.recurringPaymentRepository.save(plan);
  }

  async findAll(createdBy: string): Promise<RecurringPayment[]> {
    return this.recurringPaymentRepository.find({
      where: { createdBy },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string, createdBy: string): Promise<RecurringPayment> {
    const plan = await this.recurringPaymentRepository.findOneBy({
      id,
      createdBy,
    });
    if (!plan) {
      throw new NotFoundException(`Recurring payment plan ${id} not found`);
    }
    return plan;
  }

  async pause(id: string, createdBy: string): Promise<RecurringPayment> {
    const plan = await this.findOne(id, createdBy);
    if (plan.status !== RecurringPaymentStatus.ACTIVE) {
      throw new ConflictException(
        `Cannot pause a plan with status ${plan.status}`,
      );
    }
    plan.status = RecurringPaymentStatus.PAUSED;
    return this.recurringPaymentRepository.save(plan);
  }

  async resume(id: string, createdBy: string): Promise<RecurringPayment> {
    const plan = await this.findOne(id, createdBy);
    if (plan.status !== RecurringPaymentStatus.PAUSED) {
      throw new ConflictException(
        `Cannot resume a plan with status ${plan.status}`,
      );
    }
    plan.status = RecurringPaymentStatus.ACTIVE;
    if (plan.nextRunAt.getTime() < Date.now()) {
      plan.nextRunAt = new Date();
    }
    return this.recurringPaymentRepository.save(plan);
  }

  async cancel(id: string, createdBy: string): Promise<RecurringPayment> {
    const plan = await this.findOne(id, createdBy);
    if (plan.status === RecurringPaymentStatus.CANCELLED) {
      throw new ConflictException('Plan is already cancelled');
    }
    plan.status = RecurringPaymentStatus.CANCELLED;
    plan.cancelledAt = new Date();
    return this.recurringPaymentRepository.save(plan);
  }

  private computeNextRunAt(
    interval: RecurringPaymentInterval,
    from: Date,
  ): Date {
    const next = new Date(from);
    switch (interval) {
      case RecurringPaymentInterval.DAILY:
        next.setDate(next.getDate() + 1);
        break;
      case RecurringPaymentInterval.WEEKLY:
        next.setDate(next.getDate() + 7);
        break;
      case RecurringPaymentInterval.MONTHLY:
        next.setMonth(next.getMonth() + 1);
        break;
    }
    return next;
  }

  /**
   * Executes due recurring plans, creating a normal payment for each one via
   * the existing PaymentsService (reusing its fee/split/webhook lifecycle).
   * Guarded by an idempotency key per scheduled run to avoid double-charging
   * if the sweep overlaps or is retried.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async processDuePlans(): Promise<void> {
    const duePlans = await this.recurringPaymentRepository.find({
      where: {
        status: RecurringPaymentStatus.ACTIVE,
        nextRunAt: LessThanOrEqual(new Date()),
      },
    });

    for (const plan of duePlans) {
      await this.executePlan(plan);
    }
  }

  private async executePlan(plan: RecurringPayment): Promise<void> {
    const scheduledFor = plan.nextRunAt;
    const idempotencyKey = `recurring-payment:${plan.id}:${scheduledFor.toISOString()}`;

    try {
      const requestBody = {
        planId: plan.id,
        scheduledFor: scheduledFor.toISOString(),
      };
      const existing = await this.idempotencyService.checkKey(
        idempotencyKey,
        requestBody,
      );

      if (!existing) {
        const payment = await this.paymentsService.create({
          amount: plan.amount,
          currency: plan.currency,
          description: plan.description ?? undefined,
          merchantId: plan.merchantId ?? undefined,
          merchantEmail: plan.merchantEmail ?? undefined,
          payerEmail: plan.payerEmail ?? undefined,
          callbackUrl: plan.callbackUrl ?? undefined,
          metadata: plan.metadata ?? undefined,
        });
        await this.idempotencyService.storeKey(idempotencyKey, requestBody, {
          paymentId: payment.id,
        });
        this.logger.info(
          { planId: plan.id, paymentId: payment.id },
          'Recurring payment charge created',
        );
      }

      plan.lastRunAt = scheduledFor;
      plan.nextRunAt = this.computeNextRunAt(plan.interval, scheduledFor);
      await this.recurringPaymentRepository.save(plan);
    } catch (error) {
      this.logger.error(
        { planId: plan.id, error: error instanceof Error ? error.message : error },
        'Recurring payment charge failed',
      );
    }
  }
}
