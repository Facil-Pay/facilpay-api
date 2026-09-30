import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Payment } from './payment.entity';

export enum RefundReasonCode {
  DUPLICATE = 'DUPLICATE',
  FRAUDULENT = 'FRAUDULENT',
  REQUESTED_BY_CUSTOMER = 'REQUESTED_BY_CUSTOMER',
  PRODUCT_NOT_RECEIVED = 'PRODUCT_NOT_RECEIVED',
  PRODUCT_UNACCEPTABLE = 'PRODUCT_UNACCEPTABLE',
  OTHER = 'OTHER',
}

export enum RefundStatus {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  CLAIMABLE = 'CLAIMABLE',
  FAILED = 'FAILED',
}

@Entity('refunds')
export class Refund {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty()
  id: string;

  @Column('uuid')
  @ApiProperty()
  paymentId: string;

  @ManyToOne(() => Payment)
  @JoinColumn({ name: 'paymentId' })
  payment: Payment;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  @ApiProperty()
  amount: number;

  @Column({
    type: 'enum',
    enum: RefundReasonCode,
    default: RefundReasonCode.OTHER,
  })
  @ApiProperty({ enum: RefundReasonCode })
  reasonCode: RefundReasonCode;

  @Column({ nullable: true })
  @ApiPropertyOptional()
  reason: string;

  @Column({ type: 'varchar', length: 16, default: RefundStatus.COMPLETED })
  status: RefundStatus = RefundStatus.COMPLETED;

  @Column({ type: 'varchar', nullable: true })
  stellarTransactionHash: string | null = null;

  @Column({ type: 'varchar', nullable: true })
  claimableBalanceId: string | null = null;

  @Column({ nullable: true })
  @ApiPropertyOptional({ description: 'User ID or system actor that initiated the refund' })
  initiatedBy: string | null;

  @Column({
    type: 'enum',
    enum: RefundStatus,
    default: RefundStatus.EXECUTED,
  })
  @ApiProperty({ enum: RefundStatus, default: RefundStatus.EXECUTED })
  status: RefundStatus;

  @Column({ nullable: true })
  @ApiPropertyOptional({ description: 'User ID of the approver' })
  approvedBy: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  @ApiPropertyOptional()
  approvedAt: Date | null;

  @Column({ nullable: true })
  @ApiPropertyOptional({ description: 'User ID of the rejector' })
  rejectedBy: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  @ApiPropertyOptional()
  rejectedAt: Date | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  @ApiPropertyOptional()
  rejectionReason: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  @ApiPropertyOptional({ description: 'When this pending approval expires (72 h after creation)' })
  expiresAt: Date | null;

  @CreateDateColumn()
  @ApiProperty()
  createdAt: Date;
}
