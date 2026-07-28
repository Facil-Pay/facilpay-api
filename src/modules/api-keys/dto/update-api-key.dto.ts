import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
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
}
