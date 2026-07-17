import { ApiProperty } from '@nestjs/swagger';

export class PaymentMetricsDto {
  @ApiProperty({
    description: 'Total payment volume (sum of amounts)',
    example: 150000.5,
    type: 'number',
  })
  totalVolume: number;

  @ApiProperty({
    description: 'Total number of payments',
    example: 342,
    type: 'integer',
  })
  totalCount: number;

  @ApiProperty({
    description: 'Average payment amount',
    example: 438.6,
    type: 'number',
  })
  averageAmount: number;

  @ApiProperty({
    description: 'Period used for the aggregation',
    example: 'month',
  })
  period: string;

  @ApiProperty({
    description: 'Start of the period (ISO 8601)',
    example: '2026-07-01T00:00:00.000Z',
  })
  periodStart: string;

  @ApiProperty({
    description: 'End of the period (ISO 8601)',
    example: '2026-07-31T23:59:59.999Z',
  })
  periodEnd: string;
}

export class CurrencyBreakdownItemDto {
  @ApiProperty({ description: 'Currency code', example: 'USD' })
  currency: string;

  @ApiProperty({
    description: 'Total volume for this currency',
    example: 85000.0,
    type: 'number',
  })
  totalVolume: number;

  @ApiProperty({
    description: 'Number of payments in this currency',
    example: 200,
    type: 'integer',
  })
  count: number;

  @ApiProperty({
    description: 'Average amount in this currency',
    example: 425.0,
    type: 'number',
  })
  averageAmount: number;
}

export class CurrencyBreakdownDto {
  @ApiProperty({
    description: 'Breakdown of payments by currency',
    type: [CurrencyBreakdownItemDto],
  })
  breakdown: CurrencyBreakdownItemDto[];

  @ApiProperty({ description: 'Period used for the aggregation', example: 'month' })
  period: string;

  @ApiProperty({
    description: 'Start of the period (ISO 8601)',
    example: '2026-07-01T00:00:00.000Z',
  })
  periodStart: string;

  @ApiProperty({
    description: 'End of the period (ISO 8601)',
    example: '2026-07-31T23:59:59.999Z',
  })
  periodEnd: string;
}

export class StatusBreakdownItemDto {
  @ApiProperty({ description: 'Payment status', example: 'COMPLETED' })
  status: string;

  @ApiProperty({
    description: 'Number of payments with this status',
    example: 280,
    type: 'integer',
  })
  count: number;

  @ApiProperty({
    description: 'Percentage of total payments',
    example: 81.87,
    type: 'number',
  })
  percentage: number;

  @ApiProperty({
    description: 'Total volume for this status',
    example: 120000.0,
    type: 'number',
  })
  totalVolume: number;
}

export class StatusBreakdownDto {
  @ApiProperty({
    description: 'Breakdown of payments by status',
    type: [StatusBreakdownItemDto],
  })
  breakdown: StatusBreakdownItemDto[];

  @ApiProperty({
    description: 'Overall success rate (COMPLETED / total)',
    example: 81.87,
    type: 'number',
  })
  successRate: number;

  @ApiProperty({
    description: 'Overall failure rate (FAILED / total)',
    example: 5.26,
    type: 'number',
  })
  failureRate: number;

  @ApiProperty({ description: 'Period used for the aggregation', example: 'month' })
  period: string;

  @ApiProperty({
    description: 'Start of the period (ISO 8601)',
    example: '2026-07-01T00:00:00.000Z',
  })
  periodStart: string;

  @ApiProperty({
    description: 'End of the period (ISO 8601)',
    example: '2026-07-31T23:59:59.999Z',
  })
  periodEnd: string;
}
