import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository, DataSource, EntityManager } from 'typeorm';
import { PayoutDestination } from './entities/payout-destination.entity';
import { CreatePayoutDestinationDto } from './dto/create-payout-destination.dto';
import { VerifyPayoutDestinationDto } from './dto/verify-payout-destination.dto';
import { Refund, RefundStatus } from '../payments/refund.entity';
import { AuthService } from '../auth/auth.service';
import { StellarService } from '../stellar/stellar.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { createHash, randomBytes } from 'crypto';
import { LedgerAccount, LedgerReferenceType } from '../ledger/ledger-entry.entity';
import { appendLedgerTransaction } from '../ledger/ledger-transaction';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { Settlement } from './entities/settlement.entity';
import { SettlementAdjustment } from './entities/settlement-adjustment.entity';
import {
  MerchantSettlementConfig,
  SettlementSchedule,
  ReserveStatus,
} from './entities/merchant-settlement-config.entity';
import { UpsertSettlementConfigDto } from './dto/upsert-settlement-config.dto';
import { GetSettlementsDto } from './dto/get-settlements.dto';
import { Payment, PaymentStatus } from '../payments/payment.entity';
import { MailService } from '../auth/mail/mail.service';
import { UsersService } from '../users/users.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import {
  PaginatedResult,
} from '../../common/interfaces/paginated-result.interface';
import { EventsService } from '../events/events.service';
import { SettlementStatus } from './entities/settlement.entity';

interface SettlementStatementRow {
  paymentId: string;
  reference: string | null;
  gross: number;
  fee: number;
  net: number;
  refunds: number;
  adjustments: number;
}

@Injectable()
export class SettlementsService {
  private readonly logger = new Logger(SettlementsService.name);
  private readonly settleOnGross: boolean;

  constructor(
    @InjectRepository(Settlement)
    private readonly settlementRepo: Repository<Settlement>,
    @InjectRepository(SettlementAdjustment)
    private readonly settlementAdjustmentRepo: Repository<SettlementAdjustment>,
    @InjectRepository(MerchantSettlementConfig)
    private readonly configRepo: Repository<MerchantSettlementConfig>,
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(PayoutDestination)
    private readonly destinationRepo: Repository<PayoutDestination>,
    @InjectRepository(Refund)
    private readonly refundRepo: Repository<Refund>,
    private readonly dataSource: DataSource,
    private readonly mailService: MailService,
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
    private readonly webhooksService: WebhooksService,
    private readonly eventsService: EventsService,
    private readonly authService: AuthService,
    private readonly stellarService: StellarService,
    private readonly auditLogsService: AuditLogsService,
  ) {
    this.settleOnGross =
      String(
        this.configService.get<string | boolean>(
          'SETTLEMENT_USE_GROSS_AMOUNT',
          'false',
        ),
      ).toLowerCase() === 'true';
  }

  async preview(merchantId: string) {
    return this.dataSource.transaction('REPEATABLE READ', async manager => {
      const configs = await manager.find(MerchantSettlementConfig, { where: { userId: merchantId } });
      const previews: Array<Record<string, unknown>> = [];
      for (const config of configs) {
        const calculation = await this.calculateSettlement(manager, config);
        const next = new Date();
        next.setUTCHours(0, 0, 0, 0);
        if (config.schedule === SettlementSchedule.MONTHLY) next.setUTCMonth(next.getUTCMonth() + 1, 1);
        else next.setUTCDate(next.getUTCDate() + (config.schedule === SettlementSchedule.WEEKLY ? 7 - next.getUTCDay() : 1));
        previews.push({ currency: config.currency, schedule: config.schedule, nextSettlementAt: next, ...calculation, payments: undefined });
      }
      return { previews };
    });
  }

  private async calculateSettlement(manager: EntityManager, config: MerchantSettlementConfig) {
    const payments = await manager.createQueryBuilder(Payment, 'p')
      .where('p.status IN (:...statuses)', { statuses: [PaymentStatus.COMPLETED, PaymentStatus.PARTIALLY_REFUNDED, PaymentStatus.REFUNDED] })
      .andWhere('p.merchantId = :merchantId', { merchantId: config.userId })
      .andWhere('p.currency = :currency', { currency: config.currency })
      .andWhere('p.settlementId IS NULL')
      .getMany();
    const refunds = payments.length ? await manager.find(Refund, {
      where: { paymentId: In(payments.map(p => p.id)), status: In([RefundStatus.PENDING, RefundStatus.CLAIMABLE, 'PENDING_APPROVAL' as RefundStatus]) },
    }) : [];
    const grossAmount = payments.reduce((sum, p) => sum + Number(p.amount), 0);
    const fees = payments.reduce((sum, p) => sum + Number(p.feeAmount || 0), 0);
    const pendingRefunds = refunds.reduce((sum, r) => sum + Number(r.amount), 0);
    // PENDING/CLAIMABLE transfers already increment payment.refundedAmount.
    // Only approvals awaiting execution require an additional holdback.
    const approvalHoldback = refunds.filter(r => String(r.status) === 'PENDING_APPROVAL').reduce((sum, r) => sum + Number(r.amount), 0);
    const completedRefunds = payments.reduce((sum, p) => sum + Number(p.refundedAmount || 0), 0);
    const base = payments.reduce((sum, p) => sum + Number(this.settleOnGross ? p.amount : (p.netAmount ?? (Number(p.amount) - Number(p.feeAmount || 0)))), 0);
    const round = (amount: number) => Math.round((amount + Number.EPSILON) * 100) / 100;
    const totalAmount = round(Math.max(0, base - completedRefunds - approvalHoldback));
    const reservedAmount = round(totalAmount * Number(config.reservePercent || 0) / 100);
    return { payments, paymentCount: payments.length, grossAmount: round(grossAmount), fees: round(fees), pendingRefunds: round(pendingRefunds), completedRefunds: round(completedRefunds), totalAmount, reservedAmount, netAmount: round(totalAmount - reservedAmount) };
  }

  async listPayoutDestinations(merchantId: string): Promise<PayoutDestination[]> {
    return this.destinationRepo.find({
      where: { merchantId },
      order: { createdAt: 'DESC' },
    });
  }

  async createPayoutDestination(
    merchantId: string,
    dto: CreatePayoutDestinationDto,
    stepUpToken: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<PayoutDestination> {
    this.authService.validateStepUpToken(stepUpToken, merchantId);
    await this.stellarService.validatePayoutDestination(
      dto.stellarAddress,
      dto.assetCode,
    );

    const token = randomBytes(32).toString('hex');
    const destination = this.destinationRepo.create({
      ...dto,
      merchantId,
      assetCode: dto.assetCode.toUpperCase(),
      isDefault: false,
      verificationTokenHash: createHash('sha256').update(token).digest('hex'),
      verificationTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      coolingOffUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    const saved = await this.destinationRepo.save(destination);

    const user = await this.usersService.findOne(merchantId);
    if (user?.email) {
      await this.mailService.sendPayoutDestinationVerificationEmail(
        user.email,
        saved.id,
        saved.label,
        token,
      );
    }
    await this.auditLogsService.record({
      actorId: merchantId,
      actorType: 'user',
      action: 'payout_destination.created',
      resourceType: 'payout_destination',
      resourceId: saved.id,
      ipAddress,
      userAgent,
      metadata: { assetCode: saved.assetCode, stellarAddress: saved.stellarAddress },
    });
    if (dto.isDefault) {
      await this.destinationRepo
        .createQueryBuilder()
        .update(PayoutDestination)
        .set({ isDefault: false })
        .where('merchantId = :merchantId AND assetCode = :assetCode AND id != :id', {
          merchantId,
          assetCode: saved.assetCode,
          id: saved.id,
        })
        .execute();
      saved.isDefault = true;
      await this.destinationRepo.save(saved);
    }
    return saved;
  }

  async verifyPayoutDestination(
    merchantId: string,
    destinationId: string,
    dto: VerifyPayoutDestinationDto,
  ): Promise<PayoutDestination> {
    const destination = await this.destinationRepo.findOneBy({
      id: destinationId,
      merchantId,
    });
    if (!destination) throw new NotFoundException('Payout destination not found');
    if (!destination.verificationTokenExpiresAt || destination.verificationTokenExpiresAt < new Date()) {
      throw new BadRequestException('Verification token is invalid or expired');
    }
    const tokenHash = createHash('sha256').update(dto.token).digest('hex');
    if (tokenHash !== destination.verificationTokenHash) {
      throw new BadRequestException('Verification token is invalid or expired');
    }

    destination.verifiedAt = new Date();
    destination.verificationTokenHash = null;
    destination.verificationTokenExpiresAt = null;
    const saved = await this.destinationRepo.save(destination);
    await this.auditLogsService.record({
      actorId: merchantId,
      actorType: 'user',
      action: 'payout_destination.verified',
      resourceType: 'payout_destination',
      resourceId: saved.id,
    });
    return saved;
  }

  async updatePayoutDestination(
    merchantId: string,
    destinationId: string,
    dto: CreatePayoutDestinationDto,
    stepUpToken: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<PayoutDestination> {
    this.authService.validateStepUpToken(stepUpToken, merchantId);
    const destination = await this.destinationRepo.findOneBy({
      id: destinationId,
      merchantId,
    });
    if (!destination) throw new NotFoundException('Payout destination not found');

    await this.stellarService.validatePayoutDestination(
      dto.stellarAddress,
      dto.assetCode,
    );
    const token = randomBytes(32).toString('hex');
    Object.assign(destination, {
      ...dto,
      assetCode: dto.assetCode.toUpperCase(),
      isDefault: false,
      verifiedAt: null,
      coolingOffUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
      verificationTokenHash: createHash('sha256').update(token).digest('hex'),
      verificationTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    const saved = await this.destinationRepo.save(destination);

    const user = await this.usersService.findOne(merchantId);
    if (user?.email) {
      await this.mailService.sendPayoutDestinationVerificationEmail(
        user.email,
        saved.id,
        saved.label,
        token,
      );
    }
    await this.auditLogsService.record({
      actorId: merchantId,
      actorType: 'user',
      action: 'payout_destination.updated',
      resourceType: 'payout_destination',
      resourceId: saved.id,
      ipAddress,
      userAgent,
      metadata: { assetCode: saved.assetCode, stellarAddress: saved.stellarAddress },
    });
    return saved;
  }

  async getEligibleDestination(merchantId: string, destinationId: string, currency: string): Promise<PayoutDestination> {
    const destination = await this.destinationRepo.findOneBy({ id: destinationId, merchantId });
    if (!destination || destination.assetCode !== currency) {
      throw new BadRequestException('Payout destination does not match the settlement currency');
    }
    if (!destination.verifiedAt) {
      throw new BadRequestException('Payout destination must be email verified before use');
    }
    if (destination.coolingOffUntil && destination.coolingOffUntil > new Date()) {
      throw new BadRequestException('Payout destination is still in its cooling-off period');
    }
    return destination;
  }

  async upsertConfig(userId: string, dto: UpsertSettlementConfigDto): Promise<MerchantSettlementConfig> {
    let config = await this.configRepo.findOneBy({ userId, currency: dto.currency });
    if (!config) {
      config = this.configRepo.create({ userId, ...dto });
    } else {
      config.schedule = dto.schedule;
      config.destinationId = dto.destinationId ?? null;
    }
    if (dto.destinationId) {
      await this.getEligibleDestination(userId, dto.destinationId, dto.currency);
    }
    return this.configRepo.save(config);
  }

  /**
   * Get the current reserve config for a merchant
   */
  async getReserveConfig(userId: string, currency: string): Promise<{
    reservePercent: number;
    reserveDays: number;
    totalReservedAmount: number;
  } | null> {
    const config = await this.configRepo.findOneBy({ userId, currency });
    if (!config) return null;
    return {
      reservePercent: config.reservePercent,
      reserveDays: config.reserveDays,
      totalReservedAmount: Number(config.totalReservedAmount),
    };
  }

  async findMerchantSettlements(
    merchantId: string,
    dto?: GetSettlementsDto,
  ): Promise<PaginatedResult<Settlement>> {
    const query = this.settlementRepo.createQueryBuilder('settlement');

    query.where('settlement.merchantId = :merchantId', { merchantId });

    if (dto?.from) {
      query.andWhere('settlement.processedAt >= :fromDate', { fromDate: dto.from });
    }
    if (dto?.to) {
      query.andWhere('settlement.processedAt <= :toDate', { toDate: dto.to });
    }

    const page = dto?.page || 1;
    const limit = dto?.limit || 20;
    const skip = (page - 1) * limit;

    query.orderBy('settlement.processedAt', 'DESC');
    query.skip(skip).take(limit);

    const [data, total] = await query.getManyAndCount();

    return { data, total, page, limit };
  }

  async findAllSettlements(
    dto?: GetSettlementsDto,
  ): Promise<PaginatedResult<Settlement>> {
    const query = this.settlementRepo.createQueryBuilder('settlement');

    if (dto?.merchantId) {
      query.where('settlement.merchantId = :merchantId', { merchantId: dto.merchantId });
    }

    if (dto?.from) {
      query.andWhere('settlement.processedAt >= :fromDate', { fromDate: dto.from });
    }
    if (dto?.to) {
      query.andWhere('settlement.processedAt <= :toDate', { toDate: dto.to });
    }

    const page = dto?.page || 1;
    const limit = dto?.limit || 20;
    const skip = (page - 1) * limit;

    query.orderBy('settlement.processedAt', 'DESC');
    query.skip(skip).take(limit);

    const [data, total] = await query.getManyAndCount();

    return { data, total, page, limit };
  }

  async findAdjustmentsForSettlement(
    merchantId: string,
    settlementId: string,
  ): Promise<SettlementAdjustment[]> {
    const settlement = await this.settlementRepo.findOneBy({
      id: settlementId,
      merchantId,
    });
    if (!settlement) {
      throw new NotFoundException(`Settlement ${settlementId} not found`);
    }

    return this.settlementAdjustmentRepo.find({
      where: { settlementId },
      order: { createdAt: 'DESC' },
    });
  }

  async getSettlementStatement(
    settlementId: string,
    userId: string,
    isAdmin: boolean,
  ): Promise<{
    settlement: Settlement;
    merchant: string;
    period: { from: Date | null; to: Date };
    rows: SettlementStatementRow[];
    totals: SettlementStatementRow;
  }> {
    const settlement = await this.settlementRepo.findOneBy({ id: settlementId });
    if (!settlement) throw new NotFoundException(`Settlement ${settlementId} not found`);
    if (!isAdmin && settlement.merchantId !== userId) {
      throw new ForbiddenException('You cannot access this settlement statement');
    }

    const payments = settlement.paymentIds.length
      ? await this.paymentRepo.findBy({ id: In(settlement.paymentIds) })
      : [];
    const refunds = settlement.paymentIds.length
      ? await this.refundRepo.find({ where: { paymentId: In(settlement.paymentIds) } })
      : [];
    const adjustments = await this.settlementAdjustmentRepo.find({
      where: { settlementId: settlement.id },
    });

    const rows = payments.map((payment) => {
      const gross = Number(payment.amount || 0);
      const fee = Number(payment.feeAmount || 0);
      const net = Number(
        payment.netAmount !== undefined && payment.netAmount !== null
          ? payment.netAmount
          : gross - fee,
      );
      const paymentRefunds = refunds
        .filter((refund) => refund.paymentId === payment.id)
        .reduce((sum, refund) => sum + Number(refund.amount || 0), 0);
      const paymentAdjustments = adjustments
        .filter((adjustment) => adjustment.paymentId === payment.id)
        .reduce((sum, adjustment) => sum + Number(adjustment.amount || 0), 0);

      return {
        paymentId: payment.id,
        reference: payment.externalReference,
        gross,
        fee,
        net,
        refunds: paymentRefunds,
        adjustments: paymentAdjustments,
      };
    });

    const totals = rows.reduce<SettlementStatementRow>(
      (total, row) => ({
        paymentId: 'TOTAL',
        reference: null,
        gross: total.gross + row.gross,
        fee: total.fee + row.fee,
        net: total.net + row.net,
        refunds: total.refunds + row.refunds,
        adjustments: total.adjustments + row.adjustments,
      }),
      { paymentId: 'TOTAL', reference: null, gross: 0, fee: 0, net: 0, refunds: 0, adjustments: 0 },
    );

    const from = payments.length
      ? new Date(Math.min(...payments.map((payment) => payment.createdAt.getTime())))
      : null;
    return {
      settlement,
      merchant: settlement.merchantId,
      period: { from, to: settlement.processedAt },
      rows,
      totals,
    };
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, { timeZone: 'UTC' })
  async runDailySettlements(): Promise<void> {
    await this.processSettlementsForSchedule(SettlementSchedule.DAILY);
  }

  @Cron('0 0 * * 0', { timeZone: 'UTC' })
  async runWeeklySettlements(): Promise<void> {
    await this.processSettlementsForSchedule(SettlementSchedule.WEEKLY);
  }

  @Cron('0 0 1 * *', { timeZone: 'UTC' })
  async runMonthlySettlements(): Promise<void> {
    await this.processSettlementsForSchedule(SettlementSchedule.MONTHLY);
  }

  /**
   * Daily job to release matured reserves
   */
  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async releaseMaturedReserves(): Promise<void> {
    this.logger.log('Starting reserve release job...');

    const maturedSettlements = await this.settlementRepo
      .createQueryBuilder('settlement')
      .where('settlement.reserveStatus = :status', { status: ReserveStatus.HELD })
      .andWhere('settlement.reservedReleaseAt <= :now', { now: new Date() })
      .getMany();

    this.logger.log(`Found ${maturedSettlements.length} settlements with matured reserves`);

    for (const settlement of maturedSettlements) {
      try {
        await this.releaseSettlementReserve(settlement);
      } catch (error) {
        this.logger.error(
          `Reserve release failed for settlement ${settlement.id}`,
          error instanceof Error ? error.stack : error,
        );
      }
    }
  }

  /**
   * Release reserved funds for a settlement
   */
  private async releaseSettlementReserve(settlement: Settlement): Promise<void> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Lock and get current settlement state
      const lockedSettlement = await queryRunner.manager
        .createQueryBuilder(Settlement, 's')
        .setLock('pessimistic_write')
        .where('s.id = :id', { id: settlement.id })
        .getOne();

      if (!lockedSettlement || lockedSettlement.reserveStatus !== ReserveStatus.HELD) {
        await queryRunner.rollbackTransaction();
        return;
      }

      // Update settlement to released
      lockedSettlement.reserveStatus = ReserveStatus.RELEASED;
      lockedSettlement.releasedAmount = Number(lockedSettlement.reservedAmount);
      await queryRunner.manager.save(lockedSettlement);

      // Update merchant's total reserved amount
      const config = await queryRunner.manager
        .createQueryBuilder(MerchantSettlementConfig, 'config')
        .setLock('pessimistic_write')
        .where('config.userId = :merchantId', { merchantId: lockedSettlement.merchantId })
        .andWhere('config.currency = :currency', { currency: lockedSettlement.currency })
        .getOne();

      if (config) {
        config.totalReservedAmount = Math.max(0, Number(config.totalReservedAmount) - Number(lockedSettlement.reservedAmount));
        await queryRunner.manager.save(config);
      }

      await queryRunner.commitTransaction();
      this.logger.log(`Released reserve ${lockedSettlement.reservedAmount} for settlement ${lockedSettlement.id}`);
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  private async processSettlementsForSchedule(schedule: SettlementSchedule): Promise<void> {
    const configs = await this.configRepo.find({ where: { schedule } });

    for (const config of configs) {
      try {
        await this.processMerchantSettlement(config);
      } catch (error) {
        this.logger.error(
          `Settlement processing failed for merchant ${config.userId}`,
          error instanceof Error ? error.stack : error,
        );
      }
    }
  }

  async triggerManualRun(merchantId?: string): Promise<{
    settlementsCreated: number;
    totalAmount: number;
    settlements: Settlement[];
  }> {
    let configs: MerchantSettlementConfig[];

    if (merchantId) {
      // If merchantId is provided, process only that merchant's configs
      configs = await this.configRepo.find({ where: { userId: merchantId } });
    } else {
      // Otherwise, process all configs
      configs = await this.configRepo.find();
    }

    const settlements: Settlement[] = [];

    for (const config of configs) {
      try {
        const settlement = await this.processMerchantSettlement(config);
        if (settlement) settlements.push(settlement);
      } catch (error) {
        this.logger.error(
          `Settlement processing failed for merchant ${config.userId}`,
          error instanceof Error ? error.stack : error,
        );
      }
    }

    const totalAmount = settlements.reduce(
      (sum, s) => sum + Number(s.totalAmount),
      0,
    );

    return {
      settlementsCreated: settlements.length,
      totalAmount,
      settlements,
    };
  }

  private async processMerchantSettlement(
    config: MerchantSettlementConfig,
  ): Promise<Settlement | null> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Acquire exclusive row lock on the config row to prevent concurrent settlement runs
      const lockedConfig = await queryRunner.manager
        .createQueryBuilder(MerchantSettlementConfig, 'config')
        .setLock('pessimistic_write')
        .where('config.id = :id', { id: config.id })
        .getOne();

      if (!lockedConfig) {
        await queryRunner.rollbackTransaction();
        return null;
      }

      const merchant = await this.usersService.findOne(lockedConfig.userId);
      if (merchant.status === 'SUSPENDED') {
        await queryRunner.rollbackTransaction();
        this.logger.warn(`Skipping settlement for suspended merchant ${lockedConfig.userId}`);
        return null;
      }

      if (!lockedConfig.destinationId) {
        throw new BadRequestException('A verified payout destination is required for settlement');
      }
      await this.getEligibleDestination(
        lockedConfig.userId,
        lockedConfig.destinationId,
        lockedConfig.currency,
      );

      const calculation = await this.calculateSettlement(queryRunner.manager, lockedConfig);
      const { payments: completedPayments, totalAmount, reservedAmount, netAmount } = calculation;
      if (completedPayments.length === 0 || totalAmount <= 0) {
        await queryRunner.rollbackTransaction();
        return null;
      }
      const reserveDays = lockedConfig.reserveDays || 0;
      // Calculate release date
      const reservedReleaseAt = reserveDays > 0 
        ? new Date(Date.now() + reserveDays * 24 * 60 * 60 * 1000)
        : null;

      const settlement = queryRunner.manager.create(Settlement, {
        merchantId: lockedConfig.userId,
        schedule: lockedConfig.schedule,
        totalAmount,
        reservedAmount,
        reservedReleaseAt,
        netAmount,
        currency: lockedConfig.currency,
        payoutDestinationId: lockedConfig.destinationId,
        paymentIds: completedPayments.map((p) => p.id),
        processedAt: new Date(),
        status: SettlementStatus.PENDING,
      });

      const savedSettlement = await queryRunner.manager.save(settlement);

      if (totalAmount > 0) {
        await appendLedgerTransaction(queryRunner.manager, {
          lines: [
            {
              merchantId: savedSettlement.merchantId,
              currency: savedSettlement.currency,
              account: LedgerAccount.AVAILABLE,
              amount: -totalAmount,
              referenceType: LedgerReferenceType.SETTLEMENT,
              referenceId: savedSettlement.id,
            },
            {
              merchantId: savedSettlement.merchantId,
              currency: savedSettlement.currency,
              account: LedgerAccount.PAYOUT,
              amount: totalAmount,
              referenceType: LedgerReferenceType.SETTLEMENT,
              referenceId: savedSettlement.id,
            },
          ],
        });
      }

      await queryRunner.manager.update(
        Payment,
        { id: In(completedPayments.map((p) => p.id)) },
        { settlementId: savedSettlement.id },
      );

      lockedConfig.lastSettledAt = new Date();
      
      // Update total reserved amount
      if (reservedAmount > 0) {
        lockedConfig.totalReservedAmount = Number(lockedConfig.totalReservedAmount || 0) + reservedAmount;
      }
      
      await queryRunner.manager.save(lockedConfig);

      // Mark settlement as completed
      savedSettlement.status = SettlementStatus.COMPLETED;
      await queryRunner.manager.save(savedSettlement);

      await queryRunner.commitTransaction();

      // Send webhook and persist event (outside transaction)
      await this.dispatchSettlementEvents(savedSettlement, completedPayments.length, null);

      // Send email outside the transaction (non-critical operation)
      await this.sendSettlementEmail(lockedConfig.userId, savedSettlement, totalAmount);

      return savedSettlement;
    } catch (error) {
      // Log failed settlement
      const userId = config.userId;
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Create a failed settlement record if possible
      try {
        const failedSettlement = this.settlementRepo.create({
          merchantId: userId,
          schedule: config.schedule,
          totalAmount: 0,
          currency: config.currency,
          paymentIds: [],
          processedAt: new Date(),
          status: SettlementStatus.FAILED,
          failureReason: errorMessage,
        });
        const savedFailed = await this.settlementRepo.save(failedSettlement);
        await this.dispatchSettlementEvents(savedFailed, 0, errorMessage);
      } catch {
        // Ignore - we're already in an error state
      }

      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  private async dispatchSettlementEvents(
    settlement: Settlement,
    paymentCount: number,
    failureReason: string | null,
  ): Promise<void> {
    const payload = {
      settlementId: settlement.id,
      amount: String(settlement.totalAmount),
      currency: settlement.currency,
      paymentCount,
      stellarTransactionHash: settlement.stellarTransactionHash,
      failureReason,
    };

    // Persist domain event
    this.eventsService.emit(settlement.merchantId, 'settlement.created', payload);

    if (settlement.status === SettlementStatus.COMPLETED) {
      this.eventsService.emit(settlement.merchantId, 'settlement.completed', payload);
    } else if (settlement.status === SettlementStatus.FAILED) {
      this.eventsService.emit(settlement.merchantId, 'settlement.failed', payload);
    }

    // Dispatch webhook
    const event = settlement.status === SettlementStatus.COMPLETED
      ? 'settlement.completed'
      : settlement.status === SettlementStatus.FAILED
        ? 'settlement.failed'
        : 'settlement.created';

    await this.webhooksService.dispatchEventToMerchant(settlement.merchantId, event, payload);
  }

  private async sendSettlementEmail(
    userId: string,
    settlement: Settlement,
    totalAmount: number,
  ): Promise<void> {
    try {
      const user = await this.usersService.findOne(userId);
      if (!user?.email) return;

      await this.mailService.sendSettlementNotification(
        user.email,
        settlement,
        totalAmount,
      );
    } catch {
      // non-critical — settlement is already persisted
    }
  }
}
