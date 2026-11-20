import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { SettlementSchedule, ReserveStatus } from './merchant-settlement-config.entity';

export enum SettlementStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

@Entity('settlements')
export class Settlement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  merchantId: string;

  @Column({ type: 'enum', enum: SettlementSchedule })
  schedule: SettlementSchedule;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  totalAmount: number;

  /** Amount withheld as reserve */
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  reservedAmount: number = 0;

  /** Net amount after reserve (totalAmount - reservedAmount) */
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  netAmount: number = 0;

  @Column({ length: 3 })
  currency: string;

  @Column({ type: 'uuid', nullable: true })
  payoutDestinationId: string | null = null;

  @Column({ nullable: true })
  transactionHash: string | null = null;

  @Column({ type: 'jsonb', default: [] })
  paymentIds: string[];

  @Column({ type: 'enum', enum: SettlementStatus, default: SettlementStatus.COMPLETED })
  status: SettlementStatus;

  @Column({ nullable: true })
  stellarTransactionHash: string | null;

  /** Stellar asset the payout was settled in (XLM or CODE:ISSUER). */
  @Column({ length: 64, nullable: true })
  settlementAsset: string | null = null;

  /** Stellar asset the payer actually sent, when a conversion was needed. */
  @Column({ length: 255, nullable: true })
  sourceAsset: string | null = null;

  @Column({ type: 'decimal', precision: 20, scale: 7, nullable: true })
  sourceAmount: number | null = null;

  @Column({ type: 'decimal', precision: 20, scale: 7, nullable: true })
  destAmount: number | null = null;

  /** destination amount / source amount. */
  @Column({ type: 'decimal', precision: 20, scale: 8, nullable: true })
  conversionRate: number | null = null;

  /** Deviation between the quoted and executed conversion, in percent. */
  @Column({ type: 'decimal', precision: 10, scale: 6, nullable: true })
  slippagePercent: number | null = null;

  /** Stellar network fee paid for the path payment, in XLM. */
  @Column({ type: 'decimal', precision: 20, scale: 7, nullable: true })
  conversionFee: number | null = null;

  @Column({ length: 64, nullable: true })
  conversionTransactionHash: string | null = null;

  @Column({ nullable: true })
  failureReason: string | null;

  @Column()
  processedAt: Date;

  /** Date when reserved funds are released (processedAt + reserveDays) */
  @Column({ nullable: true })
  reservedReleaseAt: Date | null = null;

  @Column({ type: 'enum', enum: ReserveStatus, default: ReserveStatus.HELD })
  reserveStatus: ReserveStatus = ReserveStatus.HELD;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  releasedAmount: number = 0;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
