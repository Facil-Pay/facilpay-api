import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum PayoutStatus {
  PENDING = 'PENDING',
  SUBMITTED = 'SUBMITTED',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

/** Statuses whose amount is reserved against the merchant's available balance. */
export const ACTIVE_PAYOUT_STATUSES = [
  PayoutStatus.PENDING,
  PayoutStatus.SUBMITTED,
  PayoutStatus.COMPLETED,
];

@Entity('payouts')
@Index('IDX_payouts_merchant_createdAt', ['merchantId', 'createdAt'])
@Index('UQ_payouts_merchant_reference', ['merchantId', 'reference'], { unique: true })
export class Payout {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty()
  id: string;

  @Column({ type: 'uuid', nullable: true })
  @ApiPropertyOptional()
  batchId: string | null = null;

  @Column()
  @ApiProperty()
  merchantId: string;

  @Column({ length: 56 })
  @ApiProperty({ description: 'Destination Stellar account (G...)' })
  destination: string;

  @Column({ type: 'decimal', precision: 20, scale: 7 })
  @ApiProperty({ example: '125.5000000' })
  amount: string;

  @Column({ length: 12 })
  @ApiProperty({ example: 'USDC' })
  currency: string;

  @Column({ type: 'varchar', length: 28, nullable: true })
  @ApiPropertyOptional()
  memo: string | null = null;

  @Column({ length: 100 })
  @ApiProperty({ description: 'Merchant reference, unique per merchant' })
  reference: string;

  @Column({ type: 'enum', enum: PayoutStatus, default: PayoutStatus.PENDING })
  @ApiProperty({ enum: PayoutStatus })
  status: PayoutStatus;

  @Column({ type: 'varchar', length: 64, nullable: true })
  @ApiPropertyOptional()
  transactionHash: string | null = null;

  @Column({ type: 'text', nullable: true })
  @ApiPropertyOptional()
  failureReason: string | null = null;

  @Column({ type: 'timestamp', nullable: true })
  @ApiPropertyOptional()
  submittedAt: Date | null = null;

  @Column({ type: 'timestamp', nullable: true })
  @ApiPropertyOptional()
  completedAt: Date | null = null;

  @Column({ type: 'timestamp', nullable: true })
  @ApiPropertyOptional()
  failedAt: Date | null = null;

  @CreateDateColumn()
  @ApiProperty()
  createdAt: Date;

  @UpdateDateColumn()
  @ApiProperty()
  updatedAt: Date;
}
