import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsISO8601,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiKeyEnvironment, ApiKeyScope } from '../api-key.entity';

export class CreateApiKeyDto {
  @ApiProperty({ description: 'Human-readable name for this key', example: 'My integration' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional({ enum: ApiKeyScope, default: ApiKeyScope.READ })
  @IsEnum(ApiKeyScope)
  @IsOptional()
  scope?: ApiKeyScope = ApiKeyScope.READ;

  @ApiPropertyOptional({ enum: ApiKeyEnvironment, default: ApiKeyEnvironment.LIVE })
  @IsEnum(ApiKeyEnvironment)
  @IsOptional()
  environment?: ApiKeyEnvironment = ApiKeyEnvironment.LIVE;

  @ApiPropertyOptional({
    description: 'Optional expiry date (ISO 8601)',
    example: '2027-01-01T00:00:00.000Z',
  })
  @IsISO8601()
  @IsOptional()
  expiresAt?: string;

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
