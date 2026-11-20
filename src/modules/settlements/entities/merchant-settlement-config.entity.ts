import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum SettlementSchedule {
  DAILY = 'daily',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
}

export enum ReserveStatus {
  HELD = 'held',
  RELEASED = 'released',
  FORFEITED = 'forfeited',
}

@Entity('merchant_settlement_configs')
@Index(['userId', 'currency'], { unique: true })
export class MerchantSettlementConfig {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @Column({ type: 'enum', enum: SettlementSchedule, default: SettlementSchedule.MONTHLY })
  schedule: SettlementSchedule;

  @Column({ length: 3 })
  currency: string;

  /** Preferred Stellar settlement asset: XLM or CODE:ISSUER. */
  @Column({ length: 64, nullable: true })
  settlementAsset: string | null = null;

  /** Maximum tolerated conversion slippage, in percent. */
  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0.5 })
  maxSlippagePercent: number = 0.5;

  @Column({ type: 'uuid', nullable: true })
  destinationId: string | null = null;

  @Column({ nullable: true })
  lastSettledAt: Date | null = null;

  /** Reserve percentage (0-50) - amount held back from each settlement */
  @Column({ type: 'int', default: 0 })
  reservePercent: number = 0;

  /** Number of days to hold the reserve (1-180) */
  @Column({ type: 'int', default: 0 })
  reserveDays: number = 0;

  /** Current total reserved amount for this merchant/currency */
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  totalReservedAmount: number = 0;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
