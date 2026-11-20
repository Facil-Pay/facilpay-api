import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsBoolean, IsArray, IsInt, Min, Max, ArrayMinSize, ArrayMaxSize, IsTimeZone, IsObject, IsNumber, ValidateIf } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateSettingsDto {
  @ApiPropertyOptional({ description: 'Expire inactive sessions after this many minutes. Null disables idle expiration.', nullable: true, minimum: 1, maximum: 43200 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(43200)
  idleSessionTimeoutMinutes?: number | null;

  @ApiPropertyOptional({ description: 'Enable or disable invoice reminders', default: true })
  @IsOptional()
  @IsBoolean()
  remindersEnabled?: boolean;

  @ApiPropertyOptional({
    description: 'Days relative to due date to send reminders (negative = before, 0 = on due date, positive = after)',
    example: [-3, 0, 7],
    isArray: true,
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsInt({ each: true })
  @Min(-30, { each: true })
  @Max(30, { each: true })
  reminderOffsets?: number[];

  @ApiPropertyOptional({
    description: 'IANA timezone used to bucket analytics',
    example: 'America/Sao_Paulo',
  })
  @IsOptional()
  @IsTimeZone()
  timezone?: string;

  @ApiPropertyOptional({
    description:
      'Per-currency refund approval thresholds. Refunds above the amount require a second user to approve. ' +
      'Pass null to disable. Example: { "USD": 500, "EUR": 450 }',
    example: { USD: 500, EUR: 450 },
  })
  @IsOptional()
  @IsObject()
  refundApprovalThresholds?: Record<string, number> | null;

  @ApiPropertyOptional({
    description:
      'Send a single recovery email to customers who abandon a checkout with a known email. Defaults to false.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  recoveryEmailsEnabled?: boolean;

  @ApiPropertyOptional({
    description: 'Minutes after checkout expiry before the recovery email is sent.',
    default: 60,
    minimum: 0,
    maximum: 10080,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10080)
  recoveryEmailDelayMinutes?: number;
}