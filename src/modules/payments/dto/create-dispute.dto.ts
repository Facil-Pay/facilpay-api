import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { DisputeReason } from '../dispute.entity';

export class CreateDisputeDto {
  @IsUUID('4', { message: 'Payment ID must be a valid UUID' })
  paymentId: string;

  @IsEnum(DisputeReason, { message: 'Invalid dispute reason' })
  reason: DisputeReason;

  @IsOptional()
  @IsString()
  @MinLength(10, { message: 'Description must be at least 10 characters' })
  @MaxLength(2000, { message: 'Description must not exceed 2000 characters' })
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'Opened by must not exceed 1000 characters' })
  openedBy?: string;
}