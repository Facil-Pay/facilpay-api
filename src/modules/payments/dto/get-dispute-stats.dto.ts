import { IsEnum, IsISO8601, IsOptional, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { DisputeReason } from '../dispute.entity';

export class GetDisputeStatsDto {
  @IsOptional()
  @IsISO8601({}, { message: 'from must be a valid ISO 8601 date' })
  @ApiPropertyOptional({
    description: 'Start of date range (inclusive, ISO 8601)',
    example: '2026-01-01T00:00:00.000Z',
  })
  from?: string;

  @IsOptional()
  @IsISO8601({}, { message: 'to must be a valid ISO 8601 date' })
  @ApiPropertyOptional({
    description: 'End of date range (inclusive, ISO 8601)',
    example: '2026-01-31T23:59:59.999Z',
  })
  to?: string;

  @IsOptional()
  @IsUUID('4', { message: 'paymentId must be a valid UUID' })
  @ApiPropertyOptional({
    description: 'Restrict stats to a single payment',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  paymentId?: string;

  @IsOptional()
  @IsEnum(DisputeReason, { message: 'Invalid dispute reason' })
  @ApiPropertyOptional({
    description: 'Restrict stats to a single reason code',
    enum: DisputeReason,
  })
  reason?: DisputeReason;
}
