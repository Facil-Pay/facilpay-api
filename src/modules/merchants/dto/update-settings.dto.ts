import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsBoolean, IsArray, IsInt, Min, Max, ArrayMinSize, ArrayMaxSize, IsTimeZone, IsObject, IsNumber, ValidateIf } from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class UpdateSettingsDto {
  @ApiPropertyOptional({ nullable: true, minimum: 8, maximum: 3650, description: 'Revoke inactive API keys after this many days; null disables (default).' })
  @ValidateIf((_object, value) => value !== undefined && value !== null)
  @IsInt()
  @Min(8)
  @Max(3650)
  apiKeyInactivityDays?: number | null;

  @ApiPropertyOptional({ default: false, description: 'Require TOTP or a passkey for every team member. Owner must enroll first.' })
  @ValidateIf((_object, value) => value !== undefined)
  @IsBoolean()
  @Transform(({ obj }) => obj.require2fa)
  require2fa?: boolean;

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
      'Enable per-payment Stellar muxed (M-address) deposit addresses for this merchant. ' +
      'When enabled, new payments receive a unique deposit address that matches incoming deposits without a memo.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  muxedAccountsEnabled?: boolean;

  @ApiPropertyOptional({
    description:
      'Per-currency refund approval thresholds. Refunds above the amount require a second user to approve. ' +
      'Pass null to disable. Example: { "USD": 500, "EUR": 450 }',
    example: { USD: 500, EUR: 450 },
  })
  @IsOptional()
  @IsObject()
  refundApprovalThresholds?: Record<string, number> | null;
}