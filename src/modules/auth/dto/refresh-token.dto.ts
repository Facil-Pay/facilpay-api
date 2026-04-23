import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty()
  @ApiProperty({
    description: 'The refresh token obtained at login',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  refresh_token: string;
}
