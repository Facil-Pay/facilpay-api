import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiKeyScope } from '../api-key.entity';

export class UpdateApiKeyDto {
  @ApiPropertyOptional({ description: 'Human-readable name for this key', example: 'My integration' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ enum: ApiKeyScope })
  @IsEnum(ApiKeyScope)
  @IsOptional()
  scope?: ApiKeyScope;
}
