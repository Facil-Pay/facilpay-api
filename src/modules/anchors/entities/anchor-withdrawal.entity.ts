import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AnchorConfig } from './anchor-config.entity';

export enum AnchorWithdrawalStatus {
  /** Interactive URL returned; waiting for the user to complete KYC/bank flow. */
  PENDING_USER = 'PENDING_USER',
  /** User completed the web flow; waiting for the anchor to process. */
  PENDING_ANCHOR = 'PENDING_ANCHOR',
  /** Stellar on-chain send required from the merchant. */
  PENDING_STELLAR = 'PENDING_STELLAR',
  /** Fiat has been released by the anchor. */
  COMPLETED = 'COMPLETED',
  /** Anchor reported an error or refunded the transaction. */
  FAILED = 'FAILED',
  /** User or merchant cancelled before the on-chain send. */
  CANCELLED = 'CANCELLED',
}

@Entity('anchor_withdrawals')
@Index('IDX_anchor_withdrawals_merchant_createdAt', ['merchantId', 'createdAt'])
export class AnchorWithdrawal {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty()
  id: string;

  @ApiProperty({ description: 'Merchant that initiated this withdrawal' })
  @Index('IDX_anchor_withdrawals_merchantId')
  @Column({ type: 'varchar' })
  merchantId: string;

  @ApiProperty({ description: 'Anchor config used for this withdrawal' })
  @Column({ type: 'uuid' })
  anchorConfigId: string;

  @ManyToOne(() => AnchorConfig)
  @JoinColumn({ name: 'anchorConfigId' })
  anchorConfig: AnchorConfig;

  @ApiProperty({ description: 'SEP-24 transaction ID returned by the anchor' })
  @Index('IDX_anchor_withdrawals_anchorTxId', { unique: true })
  @Column({ type: 'varchar', length: 128 })
  anchorTransactionId: string;

  @ApiProperty({ description: 'Asset code being withdrawn (e.g. USDC)' })
  @Column({ type: 'varchar', length: 12 })
  assetCode: string;

  @ApiProperty({ description: 'Amount requested' })
  @Column({ type: 'decimal', precision: 20, scale: 7 })
  amount: string;

  @ApiProperty({ enum: AnchorWithdrawalStatus })
  @Column({
    type: 'enum',
    enum: AnchorWithdrawalStatus,
    default: AnchorWithdrawalStatus.PENDING_USER,
  })
  status: AnchorWithdrawalStatus;

  @ApiPropertyOptional({ description: 'Interactive URL the user must visit' })
  @Column({ type: 'text', nullable: true })
  interactiveUrl: string | null;

  @ApiPropertyOptional({ description: 'Stellar address the merchant must send funds to' })
  @Column({ type: 'varchar', length: 128, nullable: true })
  withdrawAnchorAccount: string | null;

  @ApiPropertyOptional({ description: 'Memo the merchant must include with the on-chain send' })
  @Column({ type: 'varchar', length: 64, nullable: true })
  withdrawMemo: string | null;

  @ApiPropertyOptional({ description: 'Memo type (text, hash, id)' })
  @Column({ type: 'varchar', length: 10, nullable: true })
  withdrawMemoType: string | null;

  @ApiPropertyOptional({ description: 'On-chain transaction hash once the Stellar send is complete' })
  @Column({ type: 'varchar', length: 128, nullable: true })
  stellarTransactionHash: string | null;

  @ApiPropertyOptional({ description: 'Failure reason when status is FAILED' })
  @Column({ type: 'text', nullable: true })
  failureReason: string | null;

  @ApiProperty()
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @ApiProperty()
  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
