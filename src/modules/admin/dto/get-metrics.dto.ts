import { IsDateString, IsEnum, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export enum MetricsInterval {
  DAY = 'day',
  WEEK = 'week',
  MONTH = 'month',
}

export class GetMetricsDto {
  @ApiPropertyOptional({ example: '2023-01-01T00:00:00Z' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2023-12-31T23:59:59Z' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ enum: MetricsInterval, default: MetricsInterval.DAY })
  @IsOptional()
  @IsEnum(MetricsInterval)
  interval?: MetricsInterval = MetricsInterval.DAY;
}
