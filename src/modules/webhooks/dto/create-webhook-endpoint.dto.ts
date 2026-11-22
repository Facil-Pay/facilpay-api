import { IsUrl, IsArray, ArrayNotEmpty, IsEnum, ArrayUnique, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WEBHOOK_EVENT_TYPES, WebhookEventType } from '../entities/webhook-endpoint.entity';
import { SUPPORTED_API_VERSIONS, CURRENT_API_VERSION } from '../payload-serializers/registry';
import { IsObject } from 'class-validator';

export class CreateWebhookEndpointDto {
  @IsOptional()
  @IsObject()
  @ApiPropertyOptional({ description: 'Custom static headers. Reserved transport and signature headers are rejected. Use {} to clear.' })
  headers?: Record<string, string>;

  @IsUrl({ protocols: ['https'], require_protocol: true }, { message: 'url must be a valid HTTPS URL' })
  @ApiProperty({
    description: 'HTTPS URL that will receive webhook POST requests',
    example: 'https://merchant.example.com/webhooks',
  })
  url: string;

  @IsArray()
  @ArrayNotEmpty({ message: 'At least one event type must be specified' })
  @ArrayUnique()
  @IsEnum(WEBHOOK_EVENT_TYPES, {
    each: true,
    message: `Each event must be one of: ${WEBHOOK_EVENT_TYPES.join(', ')}`,
  })
  @ApiProperty({
    description: 'Event types this endpoint subscribes to',
    enum: WEBHOOK_EVENT_TYPES,
    isArray: true,
    example: ['payment.created', 'payment.completed'],
  })
  events: WebhookEventType[];

  @IsOptional()
  @IsString()
  @IsEnum(SUPPORTED_API_VERSIONS, {
    message: `apiVersion must be one of: ${SUPPORTED_API_VERSIONS.join(', ')}`,
  })
  @ApiPropertyOptional({
    description: `API version to use for payload serialisation. Defaults to ${CURRENT_API_VERSION}`,
    enum: SUPPORTED_API_VERSIONS,
    example: CURRENT_API_VERSION,
  })
  apiVersion?: string;
}
