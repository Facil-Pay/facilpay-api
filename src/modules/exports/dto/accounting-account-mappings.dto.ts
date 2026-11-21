import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsDefined,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { AccountingAccountMap, AccountingAccountMappings } from '../exports.service';

export class AccountingAccountMapDto implements AccountingAccountMap {
  @ApiProperty({ description: 'Income account or account code for completed payments.' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  payments: string;

  @ApiProperty({ description: 'Expense account or account code for payment fees.' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  fees: string;

  @ApiProperty({ description: 'Contra-income account or account code for refunds.' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  refunds: string;

  @ApiProperty({ description: 'Account or account code for merchant payouts.' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  payouts: string;

  @ApiProperty({ description: 'Bank, clearing, or funds-in-transit account.' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  clearing: string;
}

export class AccountingAccountMappingsDto implements AccountingAccountMappings {
  @ApiProperty({ type: AccountingAccountMapDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => AccountingAccountMapDto)
  quickbooks: AccountingAccountMapDto;

  @ApiProperty({ type: AccountingAccountMapDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => AccountingAccountMapDto)
  xero: AccountingAccountMapDto;
}
