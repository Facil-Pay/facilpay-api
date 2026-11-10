import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export enum EmailEventType {
  PAYMENT_RECEIVED = 'payment_received',
  PAYMENT_CONFIRMED = 'payment_confirmed',
  REFUND_ISSUED = 'refund_issued',
  REFUND_PROCESSED = 'refund_processed',
  REFUND_APPROVAL_REQUESTED = 'refund_approval_requested',
  REFUND_APPROVED = 'refund_approved',
  REFUND_REJECTED = 'refund_rejected',
  DISPUTE_OPENED = 'dispute_opened',
  DISPUTE_STATUS_CHANGED = 'dispute_status_changed',
  INVOICE_CREATED = 'invoice_created',
  DISPUTE_DEADLINE_REMINDER = 'dispute_deadline_reminder',
  DISPUTE_ESCALATED = 'dispute_escalated',
  DISPUTE_RESPONSE_REMINDER = 'dispute_response_reminder',
  DAILY_DIGEST = 'daily_digest',
}

export enum EmailLogStatus {
  SENT = 'sent',
  FAILED = 'failed',
  DELIVERED = 'delivered',
  BOUNCED = 'bounced',
  COMPLAINED = 'complained',
  SUPPRESSED = 'suppressed',
}

@Entity('email_logs')
export class EmailLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: EmailEventType })
  eventType: EmailEventType;

  @Index()
  @Column({ length: 255 })
  recipientEmail: string;

  @Column({ length: 50 })
  recipientRole: string;

  @Column({ length: 255 })
  subject: string;

  @Column({ type: 'enum', enum: EmailLogStatus, default: EmailLogStatus.SENT })
  status: EmailLogStatus;

  @Column({ type: 'text', nullable: true })
  errorMessage: string | null = null;

  @Index()
  @Column({ nullable: true })
  paymentId: string | null = null;

  @Column({ nullable: true })
  refundId: string | null = null;

  /** Message-ID assigned when the email was handed to the provider. */
  @Index()
  @Column({ type: 'varchar', length: 255, nullable: true })
  providerMessageId: string | null = null;

  @Column({ type: 'timestamp', nullable: true })
  statusUpdatedAt: Date | null = null;

  @Index()
  @CreateDateColumn()
  sentAt: Date;
}
