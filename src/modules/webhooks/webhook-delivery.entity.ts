import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export enum WebhookDeliveryStatus {
  PENDING = 'PENDING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  EXHAUSTED = 'EXHAUSTED',
}

export enum WebhookEventType {
  PAYMENT_CREATED = 'payment.created',
  PAYMENT_COMPLETED = 'payment.completed',
  PAYMENT_FAILED = 'payment.failed',
  PAYMENT_CANCELLED = 'payment.cancelled',
  PAYMENT_REFUNDED = 'payment.refunded',
}

@Entity('webhook_deliveries')
export class WebhookDelivery {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_webhook_deliveries_payment_id')
  @Column({ type: 'uuid' })
  paymentId: string;

  @Column()
  url: string;

  @Column({ type: 'enum', enum: WebhookEventType })
  eventType: WebhookEventType;

  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  @Column({
    type: 'enum',
    enum: WebhookDeliveryStatus,
    default: WebhookDeliveryStatus.PENDING,
  })
  @Index('idx_webhook_deliveries_status')
  status: WebhookDeliveryStatus;

  @Column({ default: 0 })
  attemptCount: number;

  @Column({ default: 5 })
  maxAttempts: number;

  @Column({ type: 'int', nullable: true })
  lastHttpStatus: number | null;

  @Column({ type: 'text', nullable: true })
  lastError: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  nextRetryAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastAttemptAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
