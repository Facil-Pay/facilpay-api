import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Request,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiOkResponse,
  ApiUnauthorizedResponse,
  ApiQuery,
} from '@nestjs/swagger';
import { SettlementsService } from './settlements.service';
import { UpsertSettlementConfigDto } from './dto/upsert-settlement-config.dto';
import { GetSettlementsDto } from './dto/get-settlements.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../../common/constants/roles';

@ApiTags('settlements')
@Controller('v1/settlements')
@UseGuards(JwtAuthGuard)
export class SettlementsController {
  constructor(private readonly service: SettlementsService) {}

  @Post('config')
  @ApiBearerAuth('bearer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Configure settlement schedule',
    description: 'Create or update the calling merchant\'s settlement schedule (daily/weekly/monthly).',
  })
  @ApiOkResponse({ description: 'Settlement config saved.' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT.' })
  upsertConfig(@Body() dto: UpsertSettlementConfigDto, @Request() req: any) {
    return this.service.upsertConfig(req.user.id, dto);
  }

  @Get()
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'List merchant settlement history',
    description: 'Returns paginated settlements for the authenticated merchant with optional date filtering.',
  })
  @ApiQuery({ name: 'from', required: false, description: 'Start date filter (ISO 8601)' })
  @ApiQuery({ name: 'to', required: false, description: 'End date filter (ISO 8601)' })
  @ApiQuery({ name: 'page', required: false, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, description: 'Items per page (default: 20, max: 100)' })
  @ApiOkResponse({ description: 'Paginated settlement list.' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT.' })
  findMerchantSettlements(
    @Request() req: any,
    @Query() dto?: GetSettlementsDto,
  ) {
    return this.service.findMerchantSettlements(req.user.id, dto);
  }
}
