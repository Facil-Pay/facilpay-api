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
  IsArray,
  Matches,
  IsBoolean,
  ArrayNotEmpty,
  ValidateIf,
} from 'class-validator';
import { ApiKeyEnvironment, ApiKeyScope } from '../api-key.entity';
import { GRANULAR_SCOPE_PATTERN } from '../scopes';

export class CreateApiKeyDto {
  @ApiPropertyOptional({ default: false, description: 'Require signed requests; signingSecret is returned once on creation' })
  @IsOptional()
  @IsBoolean()
  requireSignedRequests?: boolean;

  @ApiProperty({ description: 'Human-readable name for this key', example: 'My integration' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional({ enum: ApiKeyScope, default: ApiKeyScope.READ, deprecated: true })
  @IsEnum(ApiKeyScope)
  @IsOptional()
  scope?: ApiKeyScope = ApiKeyScope.READ;

  @ApiPropertyOptional({
    description: 'Granular scopes in resource:action format (preferred over legacy scope)',
    example: ['payments:read', 'payment-links:write'],
    isArray: true,
  })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @Matches(GRANULAR_SCOPE_PATTERN, { each: true })
  @ValidateIf((o) => o.scopes !== undefined)
  scopes?: string[];

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

