import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { MultiSigTransactionStatus } from '../entities/multi-sig-transaction.entity';

export class ListTransactionsDto {
  @IsOptional()
  @IsEnum(MultiSigTransactionStatus)
  @ApiPropertyOptional({
    enum: MultiSigTransactionStatus,
    description: 'Filter multi-sig transactions by status.',
    example: MultiSigTransactionStatus.PENDING_SIGNATURES,
  })
  status?: MultiSigTransactionStatus;
}
