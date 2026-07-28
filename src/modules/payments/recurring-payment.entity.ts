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
  PAUSED = 'paused',
  CANCELLED = 'cancelled',
}

@Entity('recurring_payments')
export class RecurringPayment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: number;

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

  @Column({ type: 'timestamp', nullable: true })
  lastRunAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  cancelledAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
