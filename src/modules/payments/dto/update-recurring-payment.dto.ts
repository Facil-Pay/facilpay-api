import {
  IsNumber,
  IsString,
  IsOptional,
  IsEnum,
  Min,
  MaxLength,
  IsPositive,
  IsBoolean,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RecurringPaymentInterval } from '../recurring-payment.entity';

export enum RecurringPaymentProrationBehavior {
  NONE = 'none',
  CREATE_ADJUSTMENT = 'create_adjustment',
}

export class UpdateRecurringPaymentDto {
  @IsNumber()
  @IsOptional()
  @IsPositive({ message: 'Amount must be a positive number' })
  @Min(0.01, { message: 'Amount must be at least 0.01' })
  @ApiPropertyOptional({
    description: 'New amount to charge on future scheduled runs',
    example: 34.99,
    minimum: 0.01,
  })
  amount?: number;

  @IsEnum(RecurringPaymentProrationBehavior)
  @IsOptional()
  @ApiPropertyOptional({
    enum: RecurringPaymentProrationBehavior,
    description: 'Whether to prorate an amount change for the current period',
    default: RecurringPaymentProrationBehavior.NONE,
  })
  prorationBehavior?: RecurringPaymentProrationBehavior;

  @IsEnum(RecurringPaymentInterval, {
    message:
      'interval must be one of: ' +
      Object.values(RecurringPaymentInterval).join(', '),
  })
  @IsOptional()
  @ApiPropertyOptional({
    enum: RecurringPaymentInterval,
    description: 'New interval applied starting from the next scheduled run',
    example: RecurringPaymentInterval.MONTHLY,
  })
  interval?: RecurringPaymentInterval;

  @IsString()
  @IsOptional()
  @MaxLength(500, { message: 'Description must not exceed 500 characters' })
  @ApiPropertyOptional({
    description: 'New description applied to future generated payments',
    example: 'Monthly subscription (updated)',
    maxLength: 500,
  })
  description?: string;

  @IsBoolean()
  @IsOptional()
  @ApiPropertyOptional({
    description: 'Whether the payer can cancel the plan from reminder emails',
  })
  payerCancellationEnabled?: boolean;
}

export class PreviewRecurringPaymentProrationDto {
  @IsNumber()
  @IsPositive({ message: 'Amount must be a positive number' })
  @Min(0.01, { message: 'Amount must be at least 0.01' })
  @ApiProperty({
    description: 'Proposed recurring amount to preview',
    example: 34.99,
    minimum: 0.01,
  })
  amount: number;
}
