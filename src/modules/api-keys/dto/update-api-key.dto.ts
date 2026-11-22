import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  IsArray,
  Matches,
  IsBoolean,
} from 'class-validator';
import { ApiKeyScope } from '../api-key.entity';

export class UpdateApiKeyDto {
  @ApiPropertyOptional({ description: 'Enable or disable signing. Enabling returns a new signingSecret once in the update response.' })
  @IsOptional()
  @IsBoolean()
  requireSignedRequests?: boolean;

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

  @ApiPropertyOptional({
    description: 'Optional list of allowed IP addresses or CIDR ranges (e.g. "192.168.1.0/24", "10.0.0.1")',
    example: ['192.168.1.0/24', '10.0.0.1'],
  })
  @IsArray()
  @IsString({ each: true })
  @Matches(/^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$|^([0-9a-fA-F]{0,4}:){1,7}[0-9a-fA-F]{0,4}(\/\d{1,3})?$/, {
    each: true,
    message: 'each value must be a valid IPv4/IPv6 address or CIDR range',
  })
  @IsOptional()
  allowedIps?: string[];
}

