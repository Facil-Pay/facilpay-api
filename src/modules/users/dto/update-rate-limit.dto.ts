import { IsBoolean, IsInt, IsOptional, Min, Max } from 'class-validator';

export class UpdateRateLimitDto {
  @IsBoolean()
  @IsOptional()
  rateLimitEnabled?: boolean;

  @IsInt()
  @Min(1)
  @Max(10000)
  @IsOptional()
  rateLimitLimit?: number;

  @IsInt()
  @Min(1000) // Minimum 1 second
  @Max(86400000) // Maximum 24 hours
  @IsOptional()
  rateLimitTtl?: number;
}