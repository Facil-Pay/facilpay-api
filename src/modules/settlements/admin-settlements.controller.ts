import { Controller, Get, Post, Query, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiOkResponse,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { SettlementsService } from './settlements.service';
import { GetSettlementsDto } from './dto/get-settlements.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../../common/constants/roles';

@ApiTags('admin')
@Controller('v1/admin/settlements')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@ApiBearerAuth('bearer')
export class AdminSettlementsController {
  constructor(private readonly service: SettlementsService) {}

  @Get()
  @ApiOperation({
    summary: 'List all settlements (admin)',
    description: 'Admin-only endpoint. Returns paginated settlements across all merchants with optional date filtering.',
  })
  @ApiQuery({ name: 'from', required: false, description: 'Start date filter (ISO 8601)' })
  @ApiQuery({ name: 'to', required: false, description: 'End date filter (ISO 8601)' })
  @ApiQuery({ name: 'page', required: false, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, description: 'Items per page (default: 20, max: 100)' })
  @ApiOkResponse({ description: 'Paginated settlement list.' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT.' })
  @ApiForbiddenResponse({ description: 'Admin role required.' })
  findAll(@Query() dto?: GetSettlementsDto) {
    return this.service.findAllSettlements(dto);
  }

  @Post('run')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Manually trigger a settlement run',
    description:
      'Admin-only endpoint. Triggers an out-of-band settlement run for all merchants with a configured settlement schedule, independent of the regular cron schedule. Returns a summary of the settlement batches created.',
  })
  @ApiOkResponse({
    description: 'Settlement run summary.',
    schema: {
      example: {
        settlementsCreated: 2,
        totalAmount: 1523.75,
        settlements: [],
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT.' })
  @ApiForbiddenResponse({ description: 'Admin role required.' })
  runSettlements() {
    return this.service.triggerManualRun();
  }
}
