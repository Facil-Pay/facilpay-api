import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class GetCustomersDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  page: number = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  limit: number = 20;

  @IsString()
  @IsOptional()
  @ApiPropertyOptional({
    description:
      'Case-insensitive partial match against customer email or name',
    example: 'jane',
  })
  search?: string;

  @IsString()
  @MaxLength(50)
  @IsOptional()
  @ApiPropertyOptional({
    description:
      'Only return customers carrying this tag (matched case-insensitively)',
    example: 'vip',
    maxLength: 50,
  })
  tag?: string;
}
