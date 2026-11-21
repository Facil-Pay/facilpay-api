import { IsUUID, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class MatchUnmatchedTransactionDto {
  @ApiProperty({ description: 'ID of the payment to link this transaction to' })
  @IsUUID()
  @IsNotEmpty()
  paymentId: string;
}
