import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyEmailQueryDto {
  @IsString()
  @IsNotEmpty()
  @ApiProperty({
    description: 'Email verification token from the registration email',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  token: string;
}
