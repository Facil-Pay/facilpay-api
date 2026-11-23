import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
export class RequestLogsQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() apiKeyId?: string;
  @ApiPropertyOptional({ enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'] })
  @IsOptional() @IsIn(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']) method?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2048) path?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(100) @Max(599) status?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(255) idempotencyKey?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() to?: string;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
  @ApiPropertyOptional({ default: 20, maximum: 100 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}
