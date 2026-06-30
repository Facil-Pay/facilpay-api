import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class DisableTwoFactorDto {
  @IsString()
  @IsNotEmpty({ message: 'Password is required' })
  @MinLength(1, { message: 'Password cannot be empty' })
  @ApiProperty({
    description: 'Account password for confirmation.',
    example: 'P@ssw0rd!',
  })
  password: string;
}
