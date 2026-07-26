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
  DISPUTE_OPENED = 'dispute_opened',
  DISPUTE_STATUS_CHANGED = 'dispute_status_changed',
}

export enum EmailLogStatus {
  SENT = 'sent',
  FAILED = 'failed',
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

  @Index()
  @CreateDateColumn()
  sentAt: Date;
}
