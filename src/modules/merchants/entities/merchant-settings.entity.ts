import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('merchant_settings')
@Index('idx_merchant_settings_merchant_id', ['merchantId'], { unique: true })
export class MerchantSettings {
  /** Null disables idle expiration, preserving existing token lifetimes. */
  @Column({ type: 'int', nullable: true })
  idleSessionTimeoutMinutes: number | null = null;

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  merchantId: string;

  @Column({ default: true })
  remindersEnabled: boolean = true;

  @Column('int', { array: true, default: [-3, 0, 7] })
  reminderOffsets: number[] = [-3, 0, 7];

  /** IANA timezone used for analytics bucketing, e.g. "America/Sao_Paulo". */
  @Column({ type: 'varchar', length: 64, default: 'UTC' })
  timezone: string = 'UTC';

  @Column({ default: false })
  recoveryEmailsEnabled: boolean = false;

  @Column({ type: 'int', default: 60 })
  recoveryEmailDelayMinutes: number = 60;

  /**
   * Per-currency refund approval thresholds.
   * Refunds above the configured amount require a second authorised user to approve.
   * Example: { "USD": 500, "EUR": 450 }
   */
  @Column({ type: 'jsonb', nullable: true })
  refundApprovalThresholds: Record<string, number> | null = null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}