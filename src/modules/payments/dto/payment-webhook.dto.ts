import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsOptional,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentStatus } from '../payment.entity';

export class PaymentWebhookDto {
  @IsString()
  @IsNotEmpty({ message: 'Payment ID is required' })
  @IsUUID('4', { message: 'Payment ID must be a valid UUID' })
  @ApiProperty({
    description: 'Payment identifier (UUID)',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  paymentId: string;

  @IsEnum(PaymentStatus, {
    message: `Status must be one of: ${Object.values(PaymentStatus).join(', ')}`,
  })
  @IsNotEmpty({ message: 'Status is required' })
  @ApiProperty({
    description: 'Payment status',
    enum: PaymentStatus,
    example: PaymentStatus.COMPLETED,
  })
  status: PaymentStatus;

  @IsString()
  @IsOptional()
  @MaxLength(255, {
    message: 'External reference must not exceed 255 characters',
  })
  @ApiPropertyOptional({
    description: 'External payment reference from payment provider',
    example: 'ext_ref_12345',
    maxLength: 255,
  })
  externalReference?: string;
}
