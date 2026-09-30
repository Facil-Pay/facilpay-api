import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum PaymentStatus {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  REFUNDED = 'REFUNDED',
  PARTIALLY_REFUNDED = 'PARTIALLY_REFUNDED',
  EXPIRED = 'EXPIRED',
  PARTIALLY_COMPLETED = 'PARTIALLY_COMPLETED',
  OVERDUE = 'OVERDUE',
}

export enum OverpaymentPolicy {
  KEEP = 'KEEP',
  AUTO_REFUND = 'AUTO_REFUND',
}

@Entity('payments')
@Index('IDX_payments_customerId_createdAt', ['customerId', 'createdAt'])
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: number;

  @Column()
  currency: string;

  @Column({
    type: 'enum',
    enum: PaymentStatus,
    default: PaymentStatus.PENDING,
  })
  status: PaymentStatus;

  @Column({ nullable: true })
  externalReference: string | null;

  @Column({ nullable: true })
  description: string | null;

  @Column({ type: 'varchar', nullable: true, length: 2048 })
  callbackUrl: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  refundedAmount: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  overpaidAmount: number;

  @Column({
    type: 'enum',
    enum: OverpaymentPolicy,
    default: OverpaymentPolicy.KEEP,
  })
  overpaymentPolicy: OverpaymentPolicy;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  feeAmount: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  netAmount: number;

  @Column({ nullable: true })
  feeBreakdown: string | null = null;

  @Column({ nullable: true })
  cancelledAt: Date | null = null;

  @Column({ nullable: true })
  expiresAt: Date | null = null;

  @Column({ nullable: true })
  expiredAt: Date | null = null;

  @Column({ nullable: true })
  merchantId: string | null = null;

  @Column({ nullable: true, length: 200 })
  customerId: string | null = null;

  @Index('IDX_payments_recurringPaymentId')
  @Column({ type: 'uuid', nullable: true })
  recurringPaymentId: string | null = null;

  @Column({ nullable: true })
  merchantEmail: string | null = null;

  @Column({ nullable: true })
  payerEmail: string | null = null;

  @Column({ nullable: true })
  payerName: string | null = null;

  @Column({ nullable: true })
  payerPhone: string | null = null;

  /** Payer's preferred email language, captured from Accept-Language at checkout. */
  @Column({ type: 'varchar', length: 10, nullable: true })
  payerLocale: string | null = null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, string> | null = null;

  @Index('IDX_payments_tags', { synchronize: false })
  @Column({ type: 'text', array: true, default: () => "'{}'" })
  tags: string[] = [];

  @Index()
  @Column({ nullable: true })
  settlementId: string | null = null;

  @Column({ nullable: true })
  paymentLinkId: string | null = null;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  invoiceId: string | null = null;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  couponId: string | null = null;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  discountAmount: number;

  @Column({ type: 'boolean', default: false })
  couponRedemptionReserved: boolean;

  successUrl?: string | null;

  @Index()
  @Column({ type: 'timestamp', nullable: true })
  dueDate: Date | null = null;

  @Column({ default: true })
  remindersEnabled: boolean = true;

  @Index()
  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
