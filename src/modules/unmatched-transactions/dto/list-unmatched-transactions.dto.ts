import { IsOptional, IsEnum, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { UnmatchedTransactionStatus } from '../entities/unmatched-transaction.entity';

export class ListUnmatchedTransactionsDto {
  @ApiPropertyOptional({ enum: UnmatchedTransactionStatus, description: 'Filter by status' })
  @IsOptional()
  @IsEnum(UnmatchedTransactionStatus)
  status?: UnmatchedTransactionStatus;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}
