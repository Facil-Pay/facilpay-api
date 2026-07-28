import {
  IsNumber,
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUrl,
  IsEmail,
  IsEnum,
  IsObject,
  IsISO8601,
  Min,
  MaxLength,
  IsPositive,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO4217CurrencyCode } from '../../../common/validators/is-iso4217-currency-code.validator';
import { RecurringPaymentInterval } from '../recurring-payment.entity';

export class CreateRecurringPaymentDto {
  @IsNumber()
  @IsNotEmpty()
  @IsPositive({ message: 'Amount must be a positive number' })
  @Min(0.01, { message: 'Amount must be at least 0.01' })
  @ApiProperty({
    description: 'Amount to charge on each scheduled run',
    example: 29.99,
    minimum: 0.01,
  })
  amount: number;

  @IsString()
  @IsNotEmpty({ message: 'Currency is required' })
  @IsISO4217CurrencyCode({ supportedOnly: true })
  @ApiProperty({
    description: 'Currency code (ISO 4217). Must be supported by this API instance.',
    example: 'USD',
    maxLength: 3,
  })
  currency: string;

  @IsEnum(RecurringPaymentInterval, {
    message:
      'interval must be one of: ' +
      Object.values(RecurringPaymentInterval).join(', '),
  })
  @ApiProperty({
    enum: RecurringPaymentInterval,
    description: 'How often the plan generates a new payment',
    example: RecurringPaymentInterval.MONTHLY,
  })
  interval: RecurringPaymentInterval;

  @IsString()
  @IsOptional()
  @MaxLength(500, { message: 'Description must not exceed 500 characters' })
  @ApiPropertyOptional({
    description: 'Optional description applied to each generated payment',
    example: 'Monthly subscription',
    maxLength: 500,
  })
  description?: string;

  @IsString()
  @IsOptional()
  @ApiPropertyOptional({
    description: 'ID of the merchant this recurring plan belongs to',
    example: 'abc123-merchant-uuid',
  })
  merchantId?: string;

  @IsEmail()
  @IsOptional()
  @ApiPropertyOptional({
    description: 'Merchant email for notifications on each generated payment',
    example: 'merchant@example.com',
  })
  merchantEmail?: string;

  @IsEmail()
  @IsOptional()
  @ApiPropertyOptional({
    description: 'Payer email for notifications on each generated payment',
    example: 'payer@example.com',
  })
  payerEmail?: string;

  @IsUrl({}, { message: 'callbackUrl must be a valid URL' })
  @IsOptional()
  @ApiPropertyOptional({
    description: 'Webhook callback URL applied to each generated payment',
    example: 'https://merchant.example.com/webhooks/payment',
    maxLength: 2048,
  })
  callbackUrl?: string;

  @IsObject()
  @IsOptional()
  @ApiPropertyOptional({
    description: 'Arbitrary key-value metadata applied to each generated payment',
    example: { orderId: 'sub_123' },
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  metadata?: Record<string, string>;

  @IsISO8601({}, { message: 'startAt must be a valid ISO 8601 date' })
  @IsOptional()
  @ApiPropertyOptional({
    description:
      'When the first charge should run. Defaults to immediately (next scheduler tick) when omitted.',
    example: '2026-08-01T00:00:00Z',
  })
  startAt?: string;
}
