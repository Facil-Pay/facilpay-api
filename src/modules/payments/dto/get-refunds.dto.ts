import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsISO8601, IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { RefundReasonCode } from '../refund.entity';

export class GetRefundsDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Filter by refund status' })
  @IsString()
  @IsOptional()
  declare status?: string;

  @ApiPropertyOptional({ description: 'Start date filter (ISO 8601 format)' })
  @IsISO8601()
  @IsOptional()
  from?: string;

  @ApiPropertyOptional({ description: 'End date filter (ISO 8601 format)' })
  @IsISO8601()
  @IsOptional()
  to?: string;

  @ApiPropertyOptional({ description: 'Filter by payment UUID' })
  @IsUUID()
  @IsOptional()
  paymentId?: string;

  @ApiPropertyOptional({ enum: RefundReasonCode })
  @IsEnum(RefundReasonCode)
  @IsOptional()
  reasonCode?: RefundReasonCode;
}