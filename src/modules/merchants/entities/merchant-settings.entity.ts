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

  /**
   * Feature flag for per-payment Stellar muxed (M-address) deposit addresses.
   * Enabled per merchant so the rollout can be gradual.
   */
  @Column({ default: false })
  muxedAccountsEnabled: boolean = false;

  @Column('int', { array: true, default: [-3, 0, 7] })
  reminderOffsets: number[] = [-3, 0, 7];

  /** IANA timezone used for analytics bucketing, e.g. "America/Sao_Paulo". */
  @Column({ type: 'varchar', length: 64, default: 'UTC' })
  timezone: string = 'UTC';

  /**
   * Per-currency refund approval thresholds.
   * Refunds above the configured amount require a second authorised user to approve.
   * Example: { "USD": 500, "EUR": 450 }
   */
  @Column({ type: 'jsonb', nullable: true })
  refundApprovalThresholds: Record<string, number> | null = null;

  /** Invoice number prefix, e.g. "INV" or "2024-INV" */
  @Column({ type: 'varchar', length: 20, nullable: true })
  invoicePrefix: string | null = null;

  /** Zero-padding for invoice numbers (e.g. 6 → "000001") */
  @Column({ type: 'int', default: 6 })
  invoiceNumberPadding: number = 6;

  /** When to reset the invoice sequence */
  @Column({
    type: 'varchar',
    length: 10,
    default: 'never',
  })
  resetSequence: 'never' | 'yearly' = 'never';

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}