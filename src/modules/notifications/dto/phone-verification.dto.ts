import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, Length } from 'class-validator';

export class SendVerificationCodeDto {
  @ApiProperty({
    example: '+1234567890',
    description: 'Phone number in E.164 format',
  })
  @IsString()
  @Matches(/^\+[1-9]\d{1,14}$/, {
    message: 'Phone number must be in E.164 format (e.g., +1234567890)',
  })
  phoneNumber: string;
}

export class VerifyPhoneNumberDto {
  @ApiProperty({
    example: '+1234567890',
    description: 'Phone number in E.164 format',
  })
  @IsString()
  @Matches(/^\+[1-9]\d{1,14}$/, {
    message: 'Phone number must be in E.164 format (e.g., +1234567890)',
  })
  phoneNumber: string;

  @ApiProperty({
    example: '123456',
    description: '6-digit verification code',
  })
  @IsString()
  @Length(6, 6)
  code: string;
}
