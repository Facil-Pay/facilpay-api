import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum RecurringPaymentChargeStatus {
  PENDING = 'pending',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
}

@Entity('recurring_payment_charges')
@Index('IDX_recurring_payment_charges_plan_attempted', [
  'recurringPaymentId',
  'attemptedAt',
])
export class RecurringPaymentCharge {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  recurringPaymentId: string;

  @Column({ type: 'int' })
  cycleNumber: number;

  @Column({ type: 'uuid', nullable: true })
  paymentId: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  prorationAmount: number;

  @Column({ type: 'varchar', length: 20 })
  status: RecurringPaymentChargeStatus;

  @Column({ type: 'text', nullable: true })
  failureReason: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  attemptedAt: Date;
}