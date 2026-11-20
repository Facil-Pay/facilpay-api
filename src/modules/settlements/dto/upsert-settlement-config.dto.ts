import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SettlementSchedule } from '../entities/merchant-settlement-config.entity';
import { IsISO4217CurrencyCode } from '../../../common/validators/is-iso4217-currency-code.validator';

export class UpsertSettlementConfigDto {
  @IsEnum(SettlementSchedule)
  @ApiProperty({ enum: SettlementSchedule, description: 'Payout frequency', example: SettlementSchedule.WEEKLY })
  schedule: SettlementSchedule;

  @IsString()
  @IsNotEmpty()
  @IsISO4217CurrencyCode({ supportedOnly: true })
  @ApiProperty({ description: 'Settlement currency', example: 'USD' })
  currency: string;

  @IsUUID()
  @IsOptional()
  @ApiPropertyOptional({ description: 'Verified payout destination for this currency' })
  destinationId?: string;

  @IsString()
  @IsOptional()
  @Matches(/^(XLM|[A-Z0-9]{1,12}:[A-Z2-7]{56})$/i, {
    message: 'settlementAsset must be XLM or CODE:ISSUER with a valid Stellar issuer',
  })
  @ApiPropertyOptional({
    description:
      'Preferred Stellar asset for payouts. XLM or CODE:ISSUER (e.g. USDC:GABC...). ' +
      'Non-matching payment balances are converted with a Stellar path payment.',
    example: 'USDC:GCKW2E6NDB2FEUOU4EERTSWNQGK7JGG7VBS7QNISJTS36NLHA5U7JROL',
  })
  settlementAsset?: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsOptional()
  @Min(0)
  @Max(100)
  @ApiPropertyOptional({
    description: 'Maximum tolerated slippage for the conversion, in percent (default 0.5)',
    example: 0.5,
  })
  maxSlippagePercent?: number;
}
