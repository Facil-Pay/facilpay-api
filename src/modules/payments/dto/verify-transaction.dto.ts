import { IsString, IsNotEmpty, Length, IsBoolean, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class VerifyTransactionDto {
  @ApiProperty({
    description: 'Stellar transaction hash to verify against this payment',
    example: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
  })
  @IsString()
  @IsNotEmpty()
  @Length(1, 128)
  transactionHash: string;

  @ApiPropertyOptional({
    description:
      'If true and the transaction matches all required fields, the payment will be ' +
      'completed immediately. Only valid when the payment is still PENDING.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  completeOnMatch?: boolean;
}
