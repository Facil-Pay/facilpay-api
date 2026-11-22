import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { LedgerAccount, LedgerReferenceType } from '../ledger-entry.entity';

export class GetLedgerEntriesDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  page: number = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @IsOptional()
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  limit: number = 20;

  @IsString()
  @Length(3, 3)
  @IsOptional()
  @ApiPropertyOptional({ example: 'USD' })
  currency?: string;

  @IsEnum(LedgerAccount)
  @IsOptional()
  @ApiPropertyOptional({ enum: LedgerAccount })
  account?: LedgerAccount;

  @IsEnum(LedgerReferenceType)
  @IsOptional()
  @ApiPropertyOptional({ enum: LedgerReferenceType })
  referenceType?: LedgerReferenceType;

  @IsISO8601()
  @IsOptional()
  @ApiPropertyOptional({ example: '2026-01-01T00:00:00.000Z' })
  from?: string;

  @IsISO8601()
  @IsOptional()
  @ApiPropertyOptional({ example: '2026-12-31T23:59:59.999Z' })
  to?: string;

  @IsIn(['json', 'csv'])
  @IsOptional()
  @ApiPropertyOptional({
    enum: ['json', 'csv'],
    default: 'json',
    description:
      'Response format. `csv` returns the entries oldest first as a file and requires both `from` and `to`; `page` and `limit` are ignored.',
  })
  format?: 'json' | 'csv';
}
