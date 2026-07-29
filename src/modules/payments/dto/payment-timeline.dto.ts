import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Represents a single event in a payment's timeline.
 * Events are aggregated from various sources (payment lifecycle, refunds, disputes, etc.)
 * and returned in chronological order.
 */
export class PaymentTimelineEvent {
  @ApiProperty({
    description: 'Event type identifier',
    example: 'payment.created',
    enum: [
      'payment.created',
      'payment.status_updated',
      'payment.cancelled',
      'payment.expired',
      'refund.created',
      'dispute.opened',
      'dispute.updated',
      'dispute.resolved',
      'dispute.closed',
    ],
  })
  type!: string;

  @ApiProperty({
    description: 'Timestamp of the event',
    example: '2026-01-26T10:00:00.000Z',
  })
  timestamp!: Date;

  @ApiPropertyOptional({
    description: 'Additional event-specific data',
    example: { amount: 100.5, currency: 'USD', status: 'PENDING' },
  })
  data?: Record<string, unknown>;
}

