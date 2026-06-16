import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @ApiPropertyOptional({
    description: 'Display name for the user.',
    example: 'Jane Doe',
    maxLength: 100,
  })
  name?: string;

  @IsOptional()
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @MaxLength(255)
  @ApiPropertyOptional({
    description: 'New email address. Triggers re-verification and resets isEmailVerified to false.',
    example: 'jane.new@example.com',
    maxLength: 255,
  })
  email?: string;
}
