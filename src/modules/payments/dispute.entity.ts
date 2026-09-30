import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Payment } from './payment.entity';

export enum DisputeStatus {
  OPEN = 'open',
  UNDER_REVIEW = 'under_review',
  ESCALATED = 'escalated',
  RESOLVED = 'resolved',
  CLOSED = 'closed',
}

export enum DisputeReason {
  FRAUD = 'fraud',
  DUPLICATE = 'duplicate',
  PRODUCT_NOT_RECEIVED = 'product_not_received',
  PRODUCT_NOT_AS_DESCRIBED = 'product_not_as_described',
  UNAUTHORIZED = 'unauthorized',
  OTHER = 'other',
}

@Entity('disputes')
@Index('IDX_disputes_status_respondBy', ['status', 'respondBy'])
export class Dispute {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  paymentId: string;

  @ManyToOne(() => Payment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'paymentId' })
  payment: Payment;

  @Column({
    type: 'enum',
    enum: DisputeStatus,
    default: DisputeStatus.OPEN,
  })
  status: DisputeStatus;

  @Column({
    type: 'enum',
    enum: DisputeReason,
  })
  reason: DisputeReason;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  disputedAmount: number | null;

  @Column({ nullable: true })
  openedBy: string | null;

  @Column({ type: 'text', nullable: true })
  resolutionNotes: string | null;

  @Column({ nullable: true })
  resolvedBy: string | null;

  @Column({ nullable: true })
  merchantEmail: string | null;

  @Column({ nullable: true })
  payerEmail: string | null;

  @Index()
  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ nullable: true })
  resolvedAt: Date | null;

  @Column({ nullable: true })
  closedAt: Date | null;

  @Column({ type: 'timestamptz' })
  respondBy: Date;

  @Column({ type: 'timestamptz', nullable: true })
  reminder3DaySentAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  reminder1DaySentAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  escalatedAt: Date | null;
}