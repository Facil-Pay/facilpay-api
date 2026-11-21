import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum UnmatchedTransactionStatus {
  PENDING = 'PENDING',
  MATCHED = 'MATCHED',
  REFUNDED = 'REFUNDED',
}

@Entity('unmatched_transactions')
export class UnmatchedTransaction {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({ description: 'Unique identifier' })
  id: string;

  @ApiProperty({ description: 'On-chain transaction hash' })
  @Index('IDX_unmatched_transactions_txHash', { unique: true })
  @Column({ type: 'varchar', length: 128 })
  transactionHash: string;

  @ApiProperty({ description: 'Sender Stellar account public key' })
  @Column({ type: 'varchar', length: 128 })
  fromAddress: string;

  @ApiProperty({ description: 'Amount received' })
  @Column({ type: 'decimal', precision: 20, scale: 7 })
  amount: string;

  @ApiProperty({ description: 'Asset code (e.g. XLM, USDC)' })
  @Column({ type: 'varchar', length: 12 })
  assetCode: string;

  @ApiPropertyOptional({ description: 'Memo attached to the on-chain transaction, if any' })
  @Column({ type: 'varchar', length: 256, nullable: true })
  memo: string | null;

  @ApiProperty({ enum: UnmatchedTransactionStatus })
  @Column({
    type: 'enum',
    enum: UnmatchedTransactionStatus,
    default: UnmatchedTransactionStatus.PENDING,
  })
  status: UnmatchedTransactionStatus;

  @ApiPropertyOptional({ description: 'Payment ID this was matched to' })
  @Index('IDX_unmatched_transactions_matchedPaymentId')
  @Column({ type: 'uuid', nullable: true })
  matchedPaymentId: string | null;

  @ApiPropertyOptional({ description: 'Who performed the manual match / refund' })
  @Column({ type: 'varchar', nullable: true })
  resolvedBy: string | null;

  @ApiPropertyOptional({ description: 'When the transaction was resolved' })
  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  @ApiProperty()
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @ApiProperty()
  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
