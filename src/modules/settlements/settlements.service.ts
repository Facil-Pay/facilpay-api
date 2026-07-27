import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Settlement } from './entities/settlement.entity';
import {
  MerchantSettlementConfig,
  SettlementSchedule,
} from './entities/merchant-settlement-config.entity';
import { UpsertSettlementConfigDto } from './dto/upsert-settlement-config.dto';
import { Payment, PaymentStatus } from '../payments/payment.entity';
import { MailService } from '../auth/mail/mail.service';
import { UsersService } from '../users/users.service';

@Injectable()
export class SettlementsService {
  constructor(
    @InjectRepository(Settlement)
    private readonly settlementRepo: Repository<Settlement>,
    @InjectRepository(MerchantSettlementConfig)
    private readonly configRepo: Repository<MerchantSettlementConfig>,
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    private readonly mailService: MailService,
    private readonly usersService: UsersService,
  ) {}

  async upsertConfig(userId: string, dto: UpsertSettlementConfigDto): Promise<MerchantSettlementConfig> {
    let config = await this.configRepo.findOneBy({ userId });
    if (!config) {
      config = this.configRepo.create({ userId, ...dto });
    } else {
      config.schedule = dto.schedule;
      config.currency = dto.currency;
    }
    return this.configRepo.save(config);
  }

  async findMerchantSettlements(merchantId: string): Promise<Settlement[]> {
    return this.settlementRepo.find({
      where: { merchantId },
      order: { processedAt: 'DESC' },
    });
  }

  async findAllSettlements(): Promise<Settlement[]> {
    return this.settlementRepo.find({ order: { processedAt: 'DESC' } });
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async runDailySettlements(): Promise<void> {
    await this.processSettlementsForSchedule(SettlementSchedule.DAILY);
  }

  @Cron('0 0 * * 0')
  async runWeeklySettlements(): Promise<void> {
    await this.processSettlementsForSchedule(SettlementSchedule.WEEKLY);
  }

  @Cron('0 0 1 * *')
  async runMonthlySettlements(): Promise<void> {
    await this.processSettlementsForSchedule(SettlementSchedule.MONTHLY);
  }

  private async processSettlementsForSchedule(schedule: SettlementSchedule): Promise<void> {
    const configs = await this.configRepo.find({ where: { schedule } });

    for (const config of configs) {
      await this.processMerchantSettlement(config);
    }
  }

  async triggerManualRun(): Promise<{
    settlementsCreated: number;
    totalAmount: number;
    settlements: Settlement[];
  }> {
    const configs = await this.configRepo.find();
    const settlements: Settlement[] = [];

    for (const config of configs) {
      const settlement = await this.processMerchantSettlement(config);
      if (settlement) settlements.push(settlement);
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
    const since = config.lastSettledAt ?? new Date(0);

    const completedPayments = await this.paymentRepo
      .createQueryBuilder('p')
      .where('p.status = :status', { status: PaymentStatus.COMPLETED })
      .andWhere('p.currency = :currency', { currency: config.currency })
      .andWhere('p.updatedAt > :since', { since })
      .getMany();

    if (completedPayments.length === 0) return null;

    const totalAmount = completedPayments.reduce(
      (sum, p) => sum + Number(p.amount),
      0,
    );

    const settlement = this.settlementRepo.create({
      merchantId: config.userId,
      schedule: config.schedule,
      totalAmount,
      currency: config.currency,
      paymentIds: completedPayments.map((p) => p.id),
      processedAt: new Date(),
    });

    await this.settlementRepo.save(settlement);

    await this.paymentRepo.update(
      { id: In(completedPayments.map((p) => p.id)) },
      { settlementId: settlement.id },
    );

    config.lastSettledAt = new Date();
    await this.configRepo.save(config);

    await this.sendSettlementEmail(config.userId, settlement, totalAmount);

    return settlement;
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
