import { IsString, IsNotEmpty, IsNumberString, IsOptional, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class StartWithdrawalDto {
  @ApiProperty({ description: 'Anchor config ID to use', example: '123e4567-e89b-12d3-a456-426614174000' })
  @IsString()
  @IsNotEmpty()
  anchorConfigId: string;

  @ApiProperty({ description: 'Asset code to withdraw', example: 'USDC' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Za-z0-9]{1,12}$/, { message: 'assetCode must be 1-12 alphanumeric characters' })
  assetCode: string;

  @ApiProperty({ description: 'Amount to withdraw', example: '100.00' })
  @IsNumberString()
  @IsNotEmpty()
  amount: string;

  @ApiPropertyOptional({ description: 'Email to pass to the anchor for the interactive flow' })
  @IsOptional()
  @IsString()
  email?: string;
}
