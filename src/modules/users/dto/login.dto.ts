import {
  IsEmail,
  IsString,
  IsNotEmpty,
  IsOptional,
  MaxLength,
  MinLength,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LoginDto {
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @IsNotEmpty({ message: 'Email is required' })
  @MaxLength(255, { message: 'Email must not exceed 255 characters' })
  @ApiProperty({
    description: 'Registered email address.',
    example: 'jane.doe@example.com',
    maxLength: 255,
  })
  email: string;

  @IsString()
  @IsNotEmpty({ message: 'Password is required' })
  @MinLength(1, { message: 'Password cannot be empty' })
  @ApiProperty({
    description: 'Account password.',
    example: 'P@ssw0rd!',
  })
  password: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'Two-factor code must be 6 digits' })
  @ApiPropertyOptional({
    description:
      'Six-digit authenticator app code. Required when 2FA is enabled.',
    example: '123456',
  })
  twoFactorCode?: string;
}
