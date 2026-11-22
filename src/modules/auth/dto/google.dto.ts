import { IsBoolean, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class GoogleAuthorizeDto {
  @IsOptional()
  @IsUrl({ require_tld: false }, { message: 'redirectUri must be a valid URL' })
  @MaxLength(2048)
  @ApiPropertyOptional({
    description: 'Override for the configured Google redirect URI (must be allow-listed)',
    example: 'https://app.facilpay.com/auth/google/callback',
  })
  redirectUri?: string;
}

export class GoogleCallbackDto {
  @IsString()
  @MaxLength(2048)
  @ApiProperty({
    description: 'Authorization code returned by Google',
    example: '4/0AVG7fi...',
  })
  code: string;

  @IsString()
  @MaxLength(256)
  @ApiProperty({
    description: 'PKCE code_verifier generated alongside the authorize step',
    example: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
  })
  codeVerifier: string;

  @IsString()
  @MaxLength(256)
  @ApiProperty({
    description: 'Opaque state returned by the authorize step for CSRF protection',
    example: 'c9f0f895fb98ab9159f51fd0297e236d',
  })
  state: string;

  @IsOptional()
  @IsUrl({ require_tld: false }, { message: 'redirectUri must be a valid URL' })
  @MaxLength(2048)
  @ApiPropertyOptional({
    description: 'Must match the redirectUri used in the authorize step when overridden',
  })
  redirectUri?: string;

  @IsOptional()
  @IsBoolean()
  @ApiPropertyOptional({
    description:
      'Explicit confirmation to link a Google verified email to an existing merchant account. Required when linking.',
    default: false,
  })
  confirmLink?: boolean;
}
