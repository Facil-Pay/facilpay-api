import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export enum SortOrder {
  ASC = 'ASC',
  DESC = 'DESC',
}

export class PaginationDto {
  @ApiPropertyOptional({ default: 1, minimum: 1, description: 'Page number (starts at 1). Use cursor for stable pagination on large datasets.' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100, description: 'Items per page (max 100)' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  limit?: number = 20;

  @ApiPropertyOptional({ description: 'Sort by field' })
  @IsString()
  @IsOptional()
  sortBy?: string;

  @ApiPropertyOptional({ enum: SortOrder, default: SortOrder.DESC, description: 'Sort order' })
  @IsEnum(SortOrder)
  @IsOptional()
  order?: SortOrder = SortOrder.DESC;

  @ApiPropertyOptional({ description: 'Cursor for cursor-based pagination (base64-encoded). When provided, page is ignored.' })
  @IsString()
  @IsOptional()
  cursor?: string;

  @ApiPropertyOptional({ description: 'Search by email (partial match)' })
  @IsString()
  @IsOptional()
  search?: string;
}
