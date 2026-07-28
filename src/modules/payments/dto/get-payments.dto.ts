import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsOptional,
  IsString,
  IsEnum,
  IsISO8601,
  IsObject,
} from 'class-validator';
import { PaymentStatus } from '../payment.entity';
import { PaginationDto, SortOrder } from '../../../common/dto/pagination.dto';

export enum PaymentSortBy {
  CREATED_AT = 'created_at',
  AMOUNT = 'amount',
  STATUS = 'status',
}

export class GetPaymentsDto extends PaginationDto {
  @ApiPropertyOptional({
    enum: PaymentStatus,
    description: 'Filter by payment status',
  })
  @IsEnum(PaymentStatus, {
    message:
      'status must be one of: ' + Object.values(PaymentStatus).join(', '),
  })
  @IsOptional()
  status?: PaymentStatus;

  @ApiPropertyOptional({
    enum: PaymentSortBy,
    default: PaymentSortBy.CREATED_AT,
    description: 'Sort by field',
  })
  @IsEnum(PaymentSortBy)
  @IsOptional()
  sortBy?: PaymentSortBy = PaymentSortBy.CREATED_AT;

  @ApiPropertyOptional({ enum: SortOrder, default: SortOrder.DESC, description: 'Sort order' })
  @IsEnum(SortOrder)
  @IsOptional()
  order?: SortOrder = SortOrder.DESC;

  @ApiPropertyOptional({
    description: 'Filter by currency code (e.g., USD, EUR)',
    example: 'USD',
  })
  @IsString()
  @IsOptional()
  currency?: string;

  @ApiPropertyOptional({
    description: 'Minimum amount (inclusive)',
    example: 10.5,
    type: 'number',
  })
  @Type(() => Number)
  @IsOptional()
  minAmount?: number;

  @ApiPropertyOptional({
    description: 'Maximum amount (inclusive)',
    example: 1000.0,
    type: 'number',
  })
  @Type(() => Number)
  @IsOptional()
  maxAmount?: number;

  @ApiPropertyOptional({
    description: 'Start date filter (ISO 8601 format)',
    example: '2026-01-01T00:00:00Z',
  })
  @IsISO8601({}, { message: 'from must be a valid ISO 8601 date' })
  @IsOptional()
  from?: string;

  @ApiPropertyOptional({
    description: 'End date filter (ISO 8601 format)',
    example: '2026-12-31T23:59:59Z',
  })
  @IsISO8601({}, { message: 'to must be a valid ISO 8601 date' })
  @IsOptional()
  to?: string;

  @ApiPropertyOptional({
    description: 'Search by description or externalReference (partial match)',
    example: 'order #123',
  })
  @IsString()
  @IsOptional()
  declare search?: string;

  @ApiPropertyOptional({
    description: 'Filter by metadata key-value pair, e.g. metadata[orderId]=order_123',
    type: 'object',
    additionalProperties: { type: 'string' },
    example: { orderId: 'order_123' },
  })
  @IsObject()
  @IsOptional()
  metadata?: Record<string, string>;
}
