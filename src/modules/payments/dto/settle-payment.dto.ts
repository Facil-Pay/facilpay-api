import { IsString, IsNotEmpty, Matches, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SettlePaymentDto {
  @IsString()
  @IsNotEmpty()
  @ApiProperty({
    description: 'Stellar destination account address (G... public key)',
    example: 'GAHJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2LFNUBSGBV3BHVJOVST',
  })
  destinationAddress: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\d+(\.\d{1,7})?$/, {
    message: 'xlmAmount must be a positive decimal with up to 7 decimal places',
  })
  @ApiProperty({
    description: 'Amount of XLM to send (Stellar native asset)',
    example: '10.5000000',
  })
  xlmAmount: string;

  @IsOptional()
  @IsString()
  @MaxLength(28)
  @ApiPropertyOptional({
    description: 'Optional Stellar memo (max 28 characters)',
    example: 'order-12345',
  })
  memo?: string;
}
