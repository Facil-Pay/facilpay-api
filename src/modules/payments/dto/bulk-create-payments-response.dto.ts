import { ApiProperty } from '@nestjs/swagger';
import { Payment } from '../payment.entity';

export class BulkCreatePaymentsResponseDto {
  @ApiProperty({
    description: 'Number of payments created successfully',
    example: 3,
  })
  created: number;

  @ApiProperty({
    type: [Payment],
    description: 'List of created payment records',
  })
  payments: Payment[];
}
