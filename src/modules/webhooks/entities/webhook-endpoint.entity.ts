import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CURRENT_API_VERSION } from '../payload-serializers/registry';
import { encryptedHeadersTransformer } from '../header-security';

export const WEBHOOK_EVENT_TYPES = [
  'payment.created',
  'payment.updated',
  'payment.completed',
  'payment.failed',
  'payment.expired',
  'payment.split_processed',
  'refund.issued',
  'refund.failed',
  'dispute.opened',
  'dispute.updated',
  'dispute.resolved',
  'dispute.closed',
  'transaction.multisig_required',
  'transaction.multisig_completed',
  'settlement.created',
  'settlement.completed',
  'settlement.failed',
  'recurring.trial_ending',
  'recurring.charge_succeeded',
  'recurring.charge_failed',
  'recurring.paused',
  'recurring.cancelled',
  'payout.created',
  'payout.completed',
  'payout.failed',
  'invoice.sent',
  'invoice.paid',
  'invoice.overdue',
  'invoice.voided',
  'customer.created',
  'customer.updated',
  'customer.deleted',
  'checkout.session.completed',
  'checkout.session.expired',
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

@Entity('webhook_endpoints')
@Index('idx_webhook_endpoints_merchant', ['merchantId'])
export class WebhookEndpoint {
  @Column({ type: 'jsonb', nullable: true, transformer: encryptedHeadersTransformer })
  @ApiPropertyOptional({ description: 'Custom delivery headers; values are masked in responses' })
  headers: Record<string, string> | null;

  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({ example: '123e4567-e89b-12d3-a456-426614174000' })
  id: string;

  @Column('uuid')
  @ApiProperty({ example: 'abc123-merchant-uuid' })
  merchantId: string;

  @Column({ length: 2048 })
  @ApiProperty({ example: 'https://merchant.example.com/webhooks' })
  url: string;

  @Column({ type: 'text', array: true })
  @ApiProperty({ example: ['payment.created', 'payment.completed'], type: [String] })
  events: WebhookEventType[];

  @Column({ default: true })
  @ApiProperty({ example: true })
  isActive: boolean;

  @Column({ length: 64 })
  @ApiProperty({
    description: 'HMAC-SHA256 signing secret — include when verifying incoming payloads',
    example: 'whsec_abc123...',
  })
  secret: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  previousSecret: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  @ApiPropertyOptional({
    description:
      'While in the future, deliveries are also signed with the previous secret',
    example: '2026-01-27T10:00:00.000Z',
    nullable: true,
  })
  previousSecretExpiresAt: Date | null;

  @Column({ type: 'int', default: 0 })
  consecutiveFailures: number;

  @Column({ type: 'timestamp', nullable: true })
  lastFailureAt: Date | null;

  @Column({ length: 64, nullable: true })
  disabledReason: string | null;

  @Column({ length: 20, default: CURRENT_API_VERSION })
  @ApiProperty({ example: '2026-09-01', description: 'Payload version for this endpoint' })
  apiVersion: string;

  @CreateDateColumn()
  @ApiProperty({ example: '2026-01-26T10:00:00.000Z' })
  createdAt: Date;

  @UpdateDateColumn()
  @ApiPropertyOptional({ example: '2026-01-26T10:05:00.000Z' })
  updatedAt: Date;
}

