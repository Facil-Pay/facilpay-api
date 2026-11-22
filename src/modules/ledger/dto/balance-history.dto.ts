import { Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class BalanceHistoryDto {
  @ApiProperty({ example: '2026-10-01' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from: string;

  @ApiProperty({ example: '2026-10-19' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to: string;
}
