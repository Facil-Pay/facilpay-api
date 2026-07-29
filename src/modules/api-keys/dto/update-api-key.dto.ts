import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiKeyScope } from '../api-key.entity';

export class UpdateApiKeyDto {
  @ApiPropertyOptional({ description: 'New name for the API key', example: 'Renamed key' })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({ enum: ApiKeyScope, description: 'New scope for the API key' })
  @IsEnum(ApiKeyScope)
  @IsOptional()
  scope?: ApiKeyScope;

  @ApiPropertyOptional({
    description:
      'Custom requests-per-window limit for this key. Overrides the global default rate limit when set.',
    example: 500,
    minimum: 1,
  })
  @IsInt()
  @IsPositive()
  @IsOptional()
  rateLimitLimit?: number;

  @ApiPropertyOptional({
    description:
      'Window size in milliseconds for rateLimitLimit. Defaults to the global window when not set.',
    example: 60000,
    minimum: 1,
  })
  @IsInt()
  @IsPositive()
  @IsOptional()
  rateLimitTtl?: number;
}
