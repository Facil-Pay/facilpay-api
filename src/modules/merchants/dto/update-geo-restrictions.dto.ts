import { IsArray, IsOptional, IsBoolean, IsISO31661Alpha2 } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateGeoRestrictionsDto {
  @IsArray()
  @IsISO31661Alpha2({ each: true, message: 'Each country code must be a valid ISO 3166-1 alpha-2 code' })
  @IsOptional()
  @ApiPropertyOptional({
    description: 'Country codes (ISO 3166-1 alpha-2) allowed to pay this merchant. If set, only these countries may pay.',
    example: ['US', 'GB', 'NG'],
    type: [String],
  })
  allowedCountries?: string[];

  @IsArray()
  @IsISO31661Alpha2({ each: true, message: 'Each country code must be a valid ISO 3166-1 alpha-2 code' })
  @IsOptional()
  @ApiPropertyOptional({
    description: 'Country codes (ISO 3166-1 alpha-2) blocked from paying this merchant.',
    example: ['KP', 'IR'],
    type: [String],
  })
  blockedCountries?: string[];

  @IsBoolean()
  @IsOptional()
  @ApiPropertyOptional({
    description:
      'When true (default), requests flagged with the X-Test-Mode header bypass geo-restriction checks entirely.',
    example: true,
  })
  bypassInTestMode?: boolean;
}
