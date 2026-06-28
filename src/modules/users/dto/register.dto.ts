import {
  IsEmail,
  IsString,
  MinLength,
  MaxLength,
  Matches,
  IsNotEmpty,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterDto {
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @IsNotEmpty({ message: 'Email is required' })
  @MaxLength(255, { message: 'Email must not exceed 255 characters' })
  @ApiProperty({
    description: 'Unique email address for the new user.',
    example: 'jane.doe@example.com',
    maxLength: 255,
  })
  email: string;

  @IsString()
  @IsNotEmpty({ message: 'Password is required' })
  @MinLength(10, { message: 'Password must be at least 10 characters long' })
  @MaxLength(128, { message: 'Password must not exceed 128 characters' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^a-zA-Z0-9])/, {
    message:
      'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character',
  })
  @ApiProperty({
    description:
      'Password for the new user (minimum 10 characters, must contain uppercase, lowercase, number, and special character).',
    example: 'P@ssw0rd!23',
    minLength: 10,
    maxLength: 128,
  })
  password: string;
}
