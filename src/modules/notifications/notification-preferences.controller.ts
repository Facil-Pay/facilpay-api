import {
  Controller,
  Get,
  Patch,
  Body,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiUnauthorizedResponse,
  ApiBody,
} from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/user.entity';
import {
  NotificationPreferencesService,
  PreferenceMap,
} from './notification-preferences.service';
import { NotificationCategory } from './notification-preference.entity';

export class UpdateNotificationPreferencesDto {
  @IsBoolean()
  @IsOptional()
  @ApiProperty({ example: true, required: false })
  payments?: boolean;

  @IsBoolean()
  @IsOptional()
  @ApiProperty({ example: true, required: false })
  refunds?: boolean;

  @IsBoolean()
  @IsOptional()
  @ApiProperty({ example: true, required: false })
  disputes?: boolean;

  @IsBoolean()
  @IsOptional()
  @ApiProperty({ example: true, required: false })
  settlements?: boolean;

  @IsBoolean()
  @IsOptional()
  @ApiProperty({ example: true, required: false })
  reports?: boolean;

  @IsBoolean()
  @IsOptional()
  @ApiProperty({
    example: false,
    required: false,
    description:
      'When enabled, per-event non-security emails are consolidated into a once-daily digest sent in the merchant timezone.',
  })
  digest?: boolean;
}

@ApiTags('users')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard)
@Controller('v1/users/me/notification-preferences')
export class NotificationPreferencesController {
  constructor(
    private readonly prefsService: NotificationPreferencesService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Get email notification preferences',
    description:
      'Returns per-category email opt-in flags. The security category is always enabled and cannot be disabled.',
  })
  @ApiOkResponse({
    schema: {
      example: {
        payments: true,
        refunds: true,
        disputes: true,
        settlements: true,
        security: true,
        reports: false,
      },
    },
  })
  @ApiUnauthorizedResponse()
  get(@CurrentUser() user: User): Promise<PreferenceMap> {
    return this.prefsService.getForUser(user.id);
  }

  @Patch()
  @ApiOperation({
    summary: 'Update email notification preferences',
    description:
      'Toggle email notifications per category. The security category cannot be disabled — any value sent for it is ignored.',
  })
  @ApiBody({ type: UpdateNotificationPreferencesDto })
  @ApiOkResponse({
    schema: {
      example: {
        payments: true,
        refunds: false,
        disputes: true,
        settlements: true,
        security: true,
        reports: false,
      },
    },
  })
  @ApiUnauthorizedResponse()
  update(
    @CurrentUser() user: User,
    @Body() dto: UpdateNotificationPreferencesDto,
  ): Promise<PreferenceMap> {
    const updates: Partial<Record<NotificationCategory, boolean>> = {};
    if (dto.payments !== undefined)
      updates[NotificationCategory.PAYMENTS] = dto.payments;
    if (dto.refunds !== undefined)
      updates[NotificationCategory.REFUNDS] = dto.refunds;
    if (dto.disputes !== undefined)
      updates[NotificationCategory.DISPUTES] = dto.disputes;
    if (dto.settlements !== undefined)
      updates[NotificationCategory.SETTLEMENTS] = dto.settlements;
    if (dto.reports !== undefined)
      updates[NotificationCategory.REPORTS] = dto.reports;
    if (dto.digest !== undefined)
      updates[NotificationCategory.DIGEST] = dto.digest;
    return this.prefsService.updateForUser(user.id, updates);
  }
}
