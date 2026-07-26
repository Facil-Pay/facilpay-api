import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const WEBHOOK_EVENT_TYPES = [
  'payment.created',
  'payment.completed',
  'payment.failed',
  'payment.expired',
  'payment.split_processed',
  'refund.issued',
  'dispute.opened',
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

@Entity('webhook_endpoints')
@Index('idx_webhook_endpoints_merchant', ['merchantId'])
export class WebhookEndpoint {
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

  @CreateDateColumn()
  @ApiProperty({ example: '2026-01-26T10:00:00.000Z' })
  createdAt: Date;

  @UpdateDateColumn()
  @ApiPropertyOptional({ example: '2026-01-26T10:05:00.000Z' })
  updatedAt: Date;
}
