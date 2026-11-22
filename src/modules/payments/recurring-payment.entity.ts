import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum RecurringPaymentInterval {
  DAILY = 'daily',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
}

export enum RecurringPaymentStatus {
  ACTIVE = 'active',
  TRIALING = 'trialing',
  PAUSED = 'paused',
  CANCELLED = 'cancelled',
}

@Entity('recurring_payments')
export class RecurringPayment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  pendingProrationAmount: number | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  prorationBaseAmount: number | null;

  @Column()
  currency: string;

  @Column({ type: 'enum', enum: RecurringPaymentInterval })
  interval: RecurringPaymentInterval;

  @Column({
    type: 'enum',
    enum: RecurringPaymentStatus,
    default: RecurringPaymentStatus.ACTIVE,
  })
  status: RecurringPaymentStatus;

  @Column({ nullable: true })
  description: string | null;

  @Column({ nullable: true })
  merchantId: string | null;

  @Column({ type: 'uuid', nullable: true })
  customerId: string | null;

  @Column({ nullable: true })
  merchantEmail: string | null;

  @Column({ nullable: true })
  payerEmail: string | null;

  @Column({ nullable: true, length: 2048 })
  callbackUrl: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, string> | null;

  @Column()
  createdBy: string;

  @Column({ type: 'timestamp' })
  nextRunAt: Date;

  @Column({ type: 'int', default: 0 })
  trialDays: number;

  @Column({ type: 'timestamp', nullable: true })
  trialEndsAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  trialEndingNotifiedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  lastRunAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  endAt: Date | null;

  @Column({ type: 'int', nullable: true })
  maxOccurrences: number | null;

  @Column({ type: 'int', default: 0 })
  occurrences: number;

  @Column({ type: 'int', default: 0 })
  consecutiveFailures: number;

  @Column({ type: 'int', default: 3 })
  notifyDaysBefore: number;

  @Column({ type: 'boolean', default: true })
  payerCancellationEnabled: boolean;

  @Column({ type: 'varchar', length: 64, nullable: true })
  cancelTokenHash: string | null;

  @Column({ type: 'timestamp', nullable: true })
  cancelTokenExpiresAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  cancelTokenUsedAt: Date | null;

  @Column({ type: 'int', nullable: true })
  lastNotifiedCycle: number | null;

  @Column({ type: 'timestamp', nullable: true })
  cancelledAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
