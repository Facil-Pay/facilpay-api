import { IsEmail, IsNotEmpty, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResetPasswordDto {
  @IsString()
  @IsNotEmpty()
  @ApiProperty({
    description: 'Password reset token from the email',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  token: string;

  @IsEmail({}, { message: 'Please provide a valid email address' })
  @IsNotEmpty()
  @ApiProperty({
    description: 'Email address of the account',
    example: 'user@example.com',
  })
  email: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(10, { message: 'Password must be at least 10 characters long' })
  @MaxLength(128, { message: 'Password must not exceed 128 characters' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^a-zA-Z0-9])/, {
    message:
      'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character',
  })
  @ApiProperty({
    description: 'New password (minimum 10 characters, must include uppercase, lowercase, number, and special character)',
    example: 'NewP@ssw0rd!23',
    minLength: 10,
    maxLength: 128,
  })
  newPassword: string;
}
