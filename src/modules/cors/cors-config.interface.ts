import { IsString, IsBoolean, IsArray, ValidateNested, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class CorsConfig {
  @IsArray()
  @IsString({ each: true })
  allowedOrigins: string[];

  @IsBoolean()
  credentials: boolean;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  allowedMethods?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  allowedHeaders?: string[];
}
