import { IsString, IsNotEmpty, IsNumber, Min, Max } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreatePaymentSplitDto {
  @IsString()
  @IsNotEmpty({ message: 'recipientAddress is required' })
  @ApiProperty({
    description: 'Destination Stellar address to receive this share of the payment',
    example: 'GABC1234567890STELLARADDRESSEXAMPLE',
  })
  recipientAddress: string;

  @IsNumber()
  @Min(0.01, { message: 'percentage must be greater than 0' })
  @Max(100, { message: 'percentage must not exceed 100' })
  @ApiProperty({
    description: 'Percentage share of the payment amount allocated to this recipient',
    example: 50,
    minimum: 0.01,
    maximum: 100,
  })
  percentage: number;
}
