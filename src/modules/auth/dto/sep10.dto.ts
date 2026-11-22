import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class Sep10ChallengeDto {
  @IsString()
  @Matches(/^G[A-Z2-7]{55}$/, { message: 'account must be a valid Stellar public key (G...)' })
  @ApiProperty({
    description: 'Stellar account (G...) requesting authentication',
    example: 'GBDJTWAHX4UV7TR55R7FJC7XK3L5B7KZJ5Q2J6Q7Q7Q7Q7Q7Q7Q7Q7Q7Q7',
  })
  account: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  @ApiPropertyOptional({
    description: 'Optional home domain override (must match server home domain)',
    example: 'auth.facilpay.com',
  })
  homeDomain?: string;
}

export class Sep10TokenDto {
  @IsString()
  @MaxLength(8192)
  @ApiProperty({
    description: 'Signed SEP-10 challenge transaction envelope (base64 XDR)',
    example: 'AAAAAg...',
  })
  transaction: string;
}
