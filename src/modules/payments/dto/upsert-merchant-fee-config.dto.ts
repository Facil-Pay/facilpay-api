import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, Min, Max, IsString } from 'class-validator';

export class UpsertMerchantFeeConfigDto {
  @IsOptional()
  @IsString()
  @ApiPropertyOptional({
    example: 'merchant-uuid',
    description: 'Merchant identifier',
  })
  merchantId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @ApiPropertyOptional({
    example: 1.5,
    description: 'Flat fee in the merchant currency',
  })
  flatFee?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  @ApiPropertyOptional({
    example: 2.5,
    description: 'Percentage fee between 0 and 100',
  })
  percentageFee?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @ApiPropertyOptional({
    example: 0.5,
    description: 'Minimum fee that should be charged',
  })
  minFee?: number;
}
