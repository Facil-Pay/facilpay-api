import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { WebhookDeliveryStatus } from '../entities/webhook-delivery.entity';

export class ListWebhookDeliveriesDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  page: number = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  limit: number = 20;

  @IsEnum(WebhookDeliveryStatus)
  @IsOptional()
  @ApiPropertyOptional({ enum: WebhookDeliveryStatus })
  status?: WebhookDeliveryStatus;

  @IsString()
  @MaxLength(100)
  @IsOptional()
  @ApiPropertyOptional({
    description: 'Only deliveries for this event type',
    example: 'payment.completed',
  })
  eventType?: string;

  @IsISO8601()
  @IsOptional()
  @ApiPropertyOptional({
    description: 'Only deliveries created at or after this time',
    example: '2026-01-01T00:00:00.000Z',
  })
  from?: string;

  @IsISO8601()
  @IsOptional()
  @ApiPropertyOptional({
    description: 'Only deliveries created at or before this time',
    example: '2026-12-31T23:59:59.999Z',
  })
  to?: string;
}
