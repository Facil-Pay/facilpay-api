import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class TwoFactorCodeDto {
  @IsString()
  @IsNotEmpty({ message: 'Two-factor code is required' })
  @Matches(/^\d{6}$/, { message: 'Two-factor code must be 6 digits' })
  @ApiProperty({
    description: 'Six-digit authenticator app code.',
    example: '123456',
  })
  code: string;
}
