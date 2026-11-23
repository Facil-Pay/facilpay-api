import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayNotEmpty, ArrayUnique, IsArray, IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { GRANULAR_SCOPE_PATTERN } from '../../api-keys/scopes';

export class RegisterOAuthAppDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(255) name: string;
  @ApiProperty({ type: [String], description: 'Exact HTTPS redirect URIs, without fragments or credentials' })
  @IsArray() @ArrayNotEmpty() @ArrayUnique() @IsString({ each: true }) redirectUris: string[];
  @ApiProperty({ type: [String], example: ['customers:read', 'webhooks:write'] })
  @IsArray() @ArrayNotEmpty() @ArrayUnique() @Matches(GRANULAR_SCOPE_PATTERN, { each: true }) scopes: string[];
}

export class OAuthAuthorizationDto {
  @ApiProperty({ enum: ['code'] }) @IsIn(['code']) response_type: 'code';
  @ApiProperty() @IsUUID() client_id: string;
  @ApiProperty() @IsString() @MaxLength(2048) redirect_uri: string;
  @ApiProperty({ description: 'Space-separated API key scopes' }) @IsString() @IsNotEmpty() @MaxLength(2048) scope: string;
  @ApiProperty() @Matches(/^[A-Za-z0-9_-]{43}$/) code_challenge: string;
  @ApiProperty({ enum: ['S256'] }) @IsIn(['S256']) code_challenge_method: 'S256';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2048) state?: string;
}

export class ApproveOAuthDto extends OAuthAuthorizationDto {
  @ApiProperty({ description: 'Explicit merchant consent; false returns access_denied' }) @IsBoolean() approved: boolean;
}

export class OAuthTokenDto {
  @ApiProperty({ enum: ['authorization_code', 'refresh_token'] }) @IsIn(['authorization_code', 'refresh_token']) grant_type: 'authorization_code' | 'refresh_token';
  @ApiProperty() @IsUUID() client_id: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(512) client_secret: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(512) code?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2048) redirect_uri?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^[A-Za-z0-9._~-]{43,128}$/) code_verifier?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(512) refresh_token?: string;
}
