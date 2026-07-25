import {
  IsNumber,
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUrl,
  IsEmail,
  Min,
  MaxLength,
  IsPositive,
  IsObject,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO4217CurrencyCode } from '../../../common/validators/is-iso4217-currency-code.validator';
import {
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from 'class-validator';

function IsMetadata(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isMetadata',
      target: (object as any).constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown, _args: ValidationArguments) {
          if (value === undefined || value === null) return true;
          if (typeof value !== 'object' || Array.isArray(value)) return false;
          const entries = Object.entries(value as Record<string, unknown>);
          if (entries.length > 20) return false;
          return entries.every(
            ([, v]) => typeof v === 'string' && v.length <= 500,
          );
        },
        defaultMessage(_args: ValidationArguments) {
          return 'metadata must have at most 20 keys, each value a string of max 500 characters';
        },
      },
    });
  };
}

export class CreatePaymentDto {
  @IsNumber()
  @IsNotEmpty()
  @IsPositive({ message: 'Amount must be a positive number' })
  @Min(0.01, { message: 'Amount must be at least 0.01' })
  @ApiProperty({
    description: 'Payment amount (must be positive)',
    example: 100.5,
    minimum: 0.01,
  })
  amount: number;

  @IsString()
  @IsNotEmpty({ message: 'Currency is required' })
  @ApiProperty({
    description: 'Currency code (ISO 4217). Must be supported by this API instance.',
    example: 'USD',
    maxLength: 3,
  })
  @IsISO4217CurrencyCode({ supportedOnly: true })
  currency: string;

  @IsString()
  @IsOptional()
  @MaxLength(500, { message: 'Description must not exceed 500 characters' })
  @ApiPropertyOptional({
    description: 'Optional payment description',
    example: 'Payment for order #12345',
    maxLength: 500,
  })
  description?: string;

  @IsUrl({}, { message: 'callbackUrl must be a valid URL' })
  @IsOptional()
  @ApiPropertyOptional({
    description: 'URL to receive outbound webhook notifications on payment status changes',
    example: 'https://merchant.example.com/webhooks/payment',
    maxLength: 2048,
  })
  callbackUrl?: string;

  @IsEmail()
  @IsOptional()
  @ApiPropertyOptional({
    description: 'Email address of the merchant for notifications',
    example: 'merchant@example.com',
  })
  merchantEmail?: string;

  @IsEmail()
  @IsOptional()
  @ApiPropertyOptional({
    description: 'Email address of the payer for notifications',
    example: 'payer@example.com',
  })
  payerEmail?: string;

  @IsObject()
  @IsMetadata()
  @IsOptional()
  @ApiPropertyOptional({
    description:
      'Arbitrary key-value metadata. Max 20 keys, each value max 500 characters.',
    example: { orderId: 'order_123', customerId: 'cust_456' },
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  metadata?: Record<string, string>;
}
