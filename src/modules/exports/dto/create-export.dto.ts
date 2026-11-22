import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';
import { ExportFilters, ExportFormat, ExportType } from '../exports.service';

export class CreateExportDto {
  @ApiProperty({
    enum: [
      'payments',
      'customers',
      'invoices',
      'refunds',
      'ledger',
      'quickbooks_iif',
      'quickbooks_csv',
      'xero_csv',
    ],
    description: 'Export type. Use resource as a backwards-compatible alias.',
  })
  @IsOptional()
  @IsIn([
    'payments',
    'customers',
    'invoices',
    'refunds',
    'ledger',
    'quickbooks_iif',
    'quickbooks_csv',
    'xero_csv',
  ])
  type?: ExportType;

  @ApiPropertyOptional({
    enum: ['payments', 'customers', 'invoices', 'refunds', 'ledger'],
    description: 'Legacy alias for type.',
  })
  @IsOptional()
  @IsIn(['payments', 'customers', 'invoices', 'refunds', 'ledger'])
  resource?: 'payments' | 'customers' | 'invoices' | 'refunds' | 'ledger';

  @ApiPropertyOptional({ enum: ['csv', 'pdf', 'iif'] })
  @IsOptional()
  @IsIn(['csv', 'pdf', 'iif'])
  format?: ExportFormat;

  @ApiPropertyOptional({ description: 'Include records created at or after this ISO 8601 date.' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'Exclude records created at or after this ISO 8601 date.' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ description: 'Filter by the resource status when supported.' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Filter by ISO currency when supported.' })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ description: 'Additional supported filters for the selected resource.' })
  @IsOptional()
  @IsObject()
  filters?: ExportFilters;
}