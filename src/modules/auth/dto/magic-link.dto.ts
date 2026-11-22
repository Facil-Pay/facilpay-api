import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RequestMagicLinkDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toLowerCase() : value)
  @IsEmail()
  @MaxLength(254)
  @ApiProperty()
  email: string;
}

export class VerifyMagicLinkDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  @ApiProperty()
  token: string;
  @IsOptional()
  @IsString()
  @MaxLength(256)
  @ApiPropertyOptional()
  deviceId?: string;
  @IsOptional()
  @IsString()
  @MaxLength(32)
  @ApiPropertyOptional({ description: 'TOTP or backup code when redeeming the returned twoFactorToken' })
  twoFactorCode?: string;
}
