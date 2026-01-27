import { IsEmail, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @IsEmail()
  @ApiProperty({
    description: 'Registered email address.',
    example: 'jane.doe@example.com',
  })
  email: string;

  @IsString()
  @ApiProperty({
    description: 'Account password.',
    example: 'P@ssw0rd!',
  })
  password: string;
}
