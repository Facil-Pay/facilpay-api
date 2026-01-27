import { IsEmail, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterDto {
  @IsEmail()
  @ApiProperty({
    description: 'Unique email address for the new user.',
    example: 'jane.doe@example.com',
  })
  email: string;

  @IsString()
  @MinLength(6)
  @ApiProperty({
    description: 'Password for the new user (minimum 6 characters).',
    example: 'P@ssw0rd!',
    minLength: 6,
  })
  password: string;
}
