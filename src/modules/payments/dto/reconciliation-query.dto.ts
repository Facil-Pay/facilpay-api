import { IsOptional, IsISO8601, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ReconciliationQueryDto {
  @IsOptional()
  @IsISO8601()
  @ApiPropertyOptional({
    description: 'Start of reporting period (ISO 8601)',
    example: '2026-01-01T00:00:00Z',
  })
  from?: string;

  @IsOptional()
  @IsISO8601()
  @ApiPropertyOptional({
    description: 'End of reporting period (ISO 8601)',
    example: '2026-01-31T23:59:59Z',
  })
  to?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional({
    description: 'Filter by currency (ISO 4217)',
    example: 'USD',
  })
  currency?: string;
}
