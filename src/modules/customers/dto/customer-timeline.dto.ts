import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class GetCustomerTimelineDto {
  @ApiPropertyOptional({
    description: 'Cursor for pagination (timestamp-id pair)',
    example: '2024-01-01T00:00:00.000Z_uuid',
  })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({
    description: 'Number of items to return',
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  limit?: number;
}

export interface TimelineEvent {
  id: string;
  type: 'payment' | 'invoice' | 'refund' | 'note' | 'dispute';
  timestamp: Date;
  data: Record<string, unknown>;
}

export interface CustomerTimelineResponse {
  data: TimelineEvent[];
  nextCursor: string | null;
}
