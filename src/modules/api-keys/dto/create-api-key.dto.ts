import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
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
}
