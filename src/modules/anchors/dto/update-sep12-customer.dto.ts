import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsObject, IsOptional, IsUUID } from 'class-validator';

export class UpdateSep12CustomerDto {
  @ApiPropertyOptional({ description: 'Existing customer ID to update.' })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty({ enum: ['sep31_sender', 'sep31_receiver'] })
  @IsIn(['sep31_sender', 'sep31_receiver'])
  type: 'sep31_sender' | 'sep31_receiver';

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsObject()
  @IsOptional()
  fields: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'SEP-31 transaction ID used to locate a customer.' })
  @IsOptional()
  @IsUUID()
  transaction_id?: string;

  @ApiPropertyOptional({
    description: 'FacilPay merchant UUID; required for receiver customer registration.',
  })
  @IsOptional()
  @IsUUID()
  merchant_id?: string;
}
