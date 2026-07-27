import { ApiProperty } from '@nestjs/swagger';

export class PaymentFeeReportDto {
  @ApiProperty({ example: 'merchant-uuid' })
  merchantId: string;

  @ApiProperty({ example: 10.5 })
  totalGrossAmount: number;

  @ApiProperty({ example: 1.05 })
  totalFeeAmount: number;

  @ApiProperty({ example: 9.45 })
  totalNetAmount: number;
}
