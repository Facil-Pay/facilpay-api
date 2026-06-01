import {
  IsNumber,
  IsString,
  IsNotEmpty,
  IsOptional,
  Min,
  MaxLength,
  IsPositive,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO4217CurrencyCode } from '../../../common/validators/is-iso4217-currency-code.validator';


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
}
