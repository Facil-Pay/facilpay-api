import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class PaginationDto {
  @ApiPropertyOptional({ default: 1, minimum: 1, description: 'Page number (starts at 1)' })
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

  @ApiPropertyOptional({ description: 'Sort by field (e.g., email, createdAt)' })
  @IsString()
  @IsOptional()
  sortBy?: string;

  @ApiPropertyOptional({ description: 'Search by email (partial match)' })
  @IsString()
  @IsOptional()
  search?: string;
}
