import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional } from 'class-validator';

export class GetCheckoutRecoveryAnalyticsDto {
  @ApiPropertyOptional({
    description: 'Inclusive lower bound of the reporting range (ISO 8601).',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    description: 'Exclusive upper bound of the reporting range (ISO 8601).',
  })
  @IsOptional()
  @IsDateString()
  to?: string;
}
