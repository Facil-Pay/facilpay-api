import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class RotateWebhookSecretDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(168)
  @IsOptional()
  @ApiPropertyOptional({
    description:
      'Hours the previous secret keeps signing deliveries alongside the new one. Defaults to 24; 0 switches secrets immediately.',
    minimum: 0,
    maximum: 168,
    default: 24,
    example: 24,
  })
  gracePeriodHours?: number;
}
