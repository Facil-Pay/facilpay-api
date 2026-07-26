import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum PaymentSplitStatus {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

@Entity('payment_splits')
export class PaymentSplit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_payment_splits_payment')
  @Column('uuid')
  paymentId: string;

  @Column()
  recipientAddress: string;

  @Column({ type: 'decimal', precision: 5, scale: 2 })
  percentage: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: number;

  @Column({
    type: 'enum',
    enum: PaymentSplitStatus,
    default: PaymentSplitStatus.PENDING,
  })
  status: PaymentSplitStatus;

  @Column({ nullable: true })
  stellarTransactionHash: string | null = null;

  @Column({ nullable: true })
  failureReason: string | null = null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
