import {
  IsNumber,
  IsString,
  IsOptional,
  IsISO8601,
  Min,
  MaxLength,
  IsPositive,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO4217CurrencyCode } from '../../../common/validators/is-iso4217-currency-code.validator';

export class UpdatePaymentLinkDto {
  @IsNumber()
  @IsOptional()
  @IsPositive({ message: 'Amount must be a positive number' })
  @Min(0.01, { message: 'Amount must be at least 0.01' })
  @ApiPropertyOptional({ description: 'Payment amount', example: 50.0, minimum: 0.01 })
  amount?: number;

  @IsString()
  @IsOptional()
  @IsISO4217CurrencyCode({ supportedOnly: true })
  @ApiPropertyOptional({ description: 'ISO 4217 currency code', example: 'USD' })
  currency?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  @ApiPropertyOptional({ description: 'Description shown on the checkout page', example: 'Invoice #42', maxLength: 500 })
  description?: string;

  @IsISO8601({}, { message: 'expiresAt must be a valid ISO 8601 date' })
  @IsOptional()
  @ApiPropertyOptional({ description: 'Optional expiry date (ISO 8601)', example: '2026-12-31T23:59:59Z' })
  expiresAt?: string;
}

