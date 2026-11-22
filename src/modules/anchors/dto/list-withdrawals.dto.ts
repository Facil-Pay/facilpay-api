import { IsOptional, IsEnum, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { AnchorWithdrawalStatus } from '../entities/anchor-withdrawal.entity';

export class ListWithdrawalsDto {
  @ApiPropertyOptional({ enum: AnchorWithdrawalStatus })
  @IsOptional()
  @IsEnum(AnchorWithdrawalStatus)
  status?: AnchorWithdrawalStatus;

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
