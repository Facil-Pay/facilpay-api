import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Payment, PaymentStatus } from './payment.entity';
import {
  StellarSettlement,
  SettlementStatus,
} from './entities/stellar-settlement.entity';
import { StellarService } from '../stellar/stellar.service';
import { SettlePaymentDto } from './dto/settle-payment.dto';

@Injectable()
export class SettlementService {
  private readonly logger = new Logger(SettlementService.name);

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    @InjectRepository(StellarSettlement)
    private readonly settlementRepository: Repository<StellarSettlement>,
    private readonly stellarService: StellarService,
  ) {}

  async settle(
    paymentId: string,
    dto: SettlePaymentDto,
  ): Promise<StellarSettlement> {
    const payment = await this.paymentRepository.findOneBy({ id: paymentId });
    if (!payment) {
      throw new NotFoundException(`Payment ${paymentId} not found`);
    }

    if (payment.status !== PaymentStatus.COMPLETED) {
      throw new ConflictException(
        `Only COMPLETED payments can be settled on Stellar. Current status: ${payment.status}`,
      );
    }

    const existing = await this.settlementRepository.findOneBy({ paymentId });
    if (existing) {
      if (existing.status === SettlementStatus.CONFIRMED) {
        throw new ConflictException(
          `Payment ${paymentId} is already settled (tx: ${existing.transactionHash})`,
        );
      }
      if (existing.status === SettlementStatus.SUBMITTED) {
        throw new ConflictException(
          `Settlement for payment ${paymentId} is already in progress`,
        );
      }
    }

    const settlement =
      existing ??
      this.settlementRepository.create({
        paymentId,
        destinationAddress: dto.destinationAddress,
        xlmAmount: dto.xlmAmount,
        memo: dto.memo,
        status: SettlementStatus.PENDING,
      });

    settlement.status = SettlementStatus.SUBMITTED;
    await this.settlementRepository.save(settlement);

    try {
      const result = await this.stellarService.sendPayment(
        dto.destinationAddress,
        dto.xlmAmount,
        dto.memo,
      );

      settlement.status = SettlementStatus.CONFIRMED;
      settlement.transactionHash = result?.hash ?? null;
      settlement.ledger = result?.ledger ?? null;
      this.logger.log(
        `Payment ${paymentId} settled on Stellar: ${result?.hash}`,
      );
    } catch (err) {
      settlement.status = SettlementStatus.FAILED;
      settlement.errorMessage =
        err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Stellar settlement failed for payment ${paymentId}: ${settlement.errorMessage}`,
      );
      await this.settlementRepository.save(settlement);
      throw err;
    }

    return this.settlementRepository.save(settlement);
  }

  async getSettlement(paymentId: string): Promise<StellarSettlement | null> {
    return this.settlementRepository.findOneBy({ paymentId });
  }
}
