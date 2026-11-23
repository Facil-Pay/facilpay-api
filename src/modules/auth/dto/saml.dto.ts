import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsFQDN, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { TeamRole } from '../../team/entities/merchant-member.entity';
export class ConfigureSamlDto {
  @ApiProperty({ description: 'Exact email domain authorized by this IdP', example: 'example.com' })
  @IsFQDN() @MaxLength(253) domain: string;
  @ApiProperty({ description: 'IdP metadata XML, including entity ID, redirect SSO service and signing certificate' })
  @IsString() @MinLength(1) @MaxLength(100000) metadataXml: string;
  @ApiPropertyOptional({ default: false, description: 'Disable password and standalone passkey sign-in for members' })
  @ValidateIf((_object, value) => value !== undefined) @IsBoolean() @Transform(({ obj }) => obj.requireSso) requireSso?: boolean;
  @ApiPropertyOptional({ enum: TeamRole, default: TeamRole.VIEWER })
  @IsOptional() @IsEnum(TeamRole) defaultRole?: TeamRole;
}
export class SamlCallbackDto {
  @ApiProperty({ description: 'Base64-encoded signed SAML response' })
  @IsString() @MinLength(1) @MaxLength(250000) SAMLResponse: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(128) RelayState?: string;
}
