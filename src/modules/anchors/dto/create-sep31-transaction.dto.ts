import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Matches,
} from 'class-validator';

export class CreateSep31TransactionDto {
  @ApiProperty({ example: '100.00' })
  @IsString()
  @MaxLength(32)
  @Matches(/^\d+(\.\d{1,7})?$/)
  amount: string;

  @ApiProperty({ example: 'USDC' })
  @IsString()
  @MaxLength(12)
  asset_code: string;

  @ApiPropertyOptional({ example: 'GDRHDSTZ4PK6VI3WL224XBJFEB6CUXQESTQPXYIB3KGITRLL7XVE4NWV' })
  @IsOptional()
  @IsString()
  @MaxLength(56)
  asset_issuer?: string;

  @ApiProperty({ description: 'SEP-12 sender customer ID.' })
  @IsUUID()
  sender_id: string;

  @ApiProperty({ description: 'SEP-12 receiver customer ID linked to a FacilPay merchant.' })
  @IsUUID()
  receiver_id: string;

  @ApiPropertyOptional({ description: 'Destination asset from SEP-38, when conversion is supported.' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  destination_asset?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  quote_id?: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  fields?: Record<string, unknown>;
}
