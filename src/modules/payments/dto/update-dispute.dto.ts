import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { DisputeStatus } from '../dispute.entity';

export class UpdateDisputeDto {
  @IsOptional()
  @IsEnum(DisputeStatus, { message: 'Invalid dispute status' })
  status?: DisputeStatus;

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'Resolution notes must not exceed 2000 characters' })
  resolutionNotes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'Resolved by must not exceed 1000 characters' })
  resolvedBy?: string;
}