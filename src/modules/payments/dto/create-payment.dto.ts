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
  @MaxLength(3, { message: 'Currency code must be 3 characters' })
  @ApiProperty({
    description: 'Currency code (ISO 4217)',
    example: 'USD',
    maxLength: 3,
  })
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
