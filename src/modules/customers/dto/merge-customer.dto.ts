import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { Customer } from '../customer.entity';

export class MergeCustomerDto {
  @ApiProperty({
    description:
      'UUID of the duplicate customer to fold into the customer in the path. It is soft-deleted after the merge.',
    example: '550e8400-e29b-41d4-a716-446655440001',
  })
  @IsUUID()
  duplicateCustomerId: string;
}

export interface MergeCustomerResult {
  customer: Customer;
  mergedCustomerId: string;
  reassigned: {
    payments: number;
    invoices: number;
    recurringPayments: number;
    checkoutSessions: number;
  };
}
