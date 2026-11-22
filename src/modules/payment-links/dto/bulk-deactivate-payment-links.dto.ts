import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export const BULK_DEACTIVATE_MAX_IDS = 100;

export class BulkDeactivatePaymentLinksDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BULK_DEACTIVATE_MAX_IDS)
  @IsUUID('4', { each: true })
  @ApiProperty({
    type: [String],
    description: `Payment link UUIDs to deactivate (max ${BULK_DEACTIVATE_MAX_IDS})`,
    example: ['3f6c1f0e-8a4b-4c3e-9d2a-1b2c3d4e5f60'],
  })
  ids: string[];
}

export type BulkDeactivateStatus = 'deactivated' | 'already_inactive' | 'skipped';

export interface BulkDeactivateResult {
  id: string;
  status: BulkDeactivateStatus;
  reason?: string;
}

export interface BulkDeactivateResponse {
  results: BulkDeactivateResult[];
  deactivated: number;
  skipped: number;
}
