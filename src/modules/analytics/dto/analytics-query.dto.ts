import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';

export enum AnalyticsPeriod {
  DAY = 'day',
  WEEK = 'week',
  MONTH = 'month',
  YEAR = 'year',
}

export class AnalyticsQueryDto {
  @ApiPropertyOptional({
    enum: AnalyticsPeriod,
    description: 'Time period for aggregation',
    default: AnalyticsPeriod.MONTH,
    example: 'month',
  })
  @IsEnum(AnalyticsPeriod, {
    message: 'period must be one of: day, week, month, year',
  })
  @IsOptional()
  period?: AnalyticsPeriod = AnalyticsPeriod.MONTH;
}
