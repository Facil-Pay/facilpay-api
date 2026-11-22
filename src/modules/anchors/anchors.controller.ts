import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiConflictResponse,
  ApiBadRequestResponse,
  ApiUnauthorizedResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/user.entity';
import { Sep24Service } from './sep24.service';
import { CreateAnchorConfigDto } from './dto/create-anchor-config.dto';
import { StartWithdrawalDto } from './dto/start-withdrawal.dto';
import { ListWithdrawalsDto } from './dto/list-withdrawals.dto';
import { AnchorConfig } from './entities/anchor-config.entity';
import { AnchorWithdrawal } from './entities/anchor-withdrawal.entity';

@ApiTags('Anchors (SEP-24)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('v1/anchors')
export class AnchorsController {
  constructor(private readonly sep24Service: Sep24Service) {}

  // ── Anchor config management ─────────────────────────────────────────────

  @Get('configs')
  @ApiOperation({ summary: 'List configured anchors' })
  @ApiOkResponse({ type: [AnchorConfig] })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
  listConfigs(@CurrentUser() user: User): Promise<AnchorConfig[]> {
    return this.sep24Service.listAnchorConfigs(user.id);
  }

  @Post('configs')
  @ApiOperation({
    summary: 'Register an anchor',
    description:
      'Saves a Stellar anchor home domain and the asset codes it supports for SEP-24 ' +
      'interactive withdrawals (off-ramp) and deposits (on-ramp).',
  })
  @ApiCreatedResponse({ type: AnchorConfig })
  @ApiConflictResponse({ description: 'Anchor for this home domain already exists' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
  createConfig(
    @CurrentUser() user: User,
    @Body() dto: CreateAnchorConfigDto,
  ): Promise<AnchorConfig> {
    return this.sep24Service.createAnchorConfig(user.id, dto);
  }

  @Delete('configs/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove an anchor config' })
  @ApiParam({ name: 'id', type: String })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: 'Config not found' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
  async deleteConfig(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    return this.sep24Service.deleteAnchorConfig(user.id, id);
  }

  // ── Withdrawals ──────────────────────────────────────────────────────────

  @Get('withdrawals')
  @ApiOperation({
    summary: 'List SEP-24 withdrawals',
    description: 'Returns withdrawals (fiat off-ramp) initiated via configured anchors.',
  })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiOkResponse({ description: 'Paginated list of withdrawals' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
  listWithdrawals(
    @CurrentUser() user: User,
    @Query() dto: ListWithdrawalsDto,
  ) {
    return this.sep24Service.listWithdrawals(user.id, dto);
  }

  @Get('withdrawals/:id')
  @ApiOperation({ summary: 'Get a single SEP-24 withdrawal' })
  @ApiParam({ name: 'id', type: String })
  @ApiOkResponse({ type: AnchorWithdrawal })
  @ApiNotFoundResponse({ description: 'Withdrawal not found' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
  getWithdrawal(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<AnchorWithdrawal> {
    return this.sep24Service.findWithdrawal(user.id, id);
  }

  @Post('withdrawals')
  @ApiOperation({
    summary: 'Start a SEP-24 interactive withdrawal',
    description:
      'Authenticates with the anchor via SEP-10 (server-side), initiates an interactive ' +
      'SEP-24 withdrawal, and returns the interactive URL the merchant should redirect the ' +
      'user to. The withdrawal status is polled every minute; status changes fire webhook ' +
      'events.',
  })
  @ApiCreatedResponse({ type: AnchorWithdrawal, description: 'Withdrawal record with interactiveUrl' })
  @ApiNotFoundResponse({ description: 'Anchor config not found or inactive' })
  @ApiBadRequestResponse({ description: 'Asset not supported by this anchor' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
  startWithdrawal(
    @CurrentUser() user: User,
    @Body() dto: StartWithdrawalDto,
  ): Promise<AnchorWithdrawal> {
    return this.sep24Service.startWithdrawal(user.id, dto);
  }

  @Post('withdrawals/:id/sync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Manually trigger a status sync for a withdrawal',
    description:
      'Forces an immediate poll of the anchor for this withdrawal status. ' +
      'Useful when testing or when a webhook callback is not available.',
  })
  @ApiParam({ name: 'id', type: String })
  @ApiOkResponse({ type: AnchorWithdrawal })
  @ApiNotFoundResponse({ description: 'Withdrawal not found' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
  async syncWithdrawal(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<AnchorWithdrawal> {
    const withdrawal = await this.sep24Service.findWithdrawal(user.id, id);
    // Load the relation needed by syncWithdrawalStatus
    if (!withdrawal.anchorConfig) {
      const full = await this.sep24Service.findWithdrawal(user.id, id);
      return this.sep24Service.syncWithdrawalStatus(full);
    }
    return this.sep24Service.syncWithdrawalStatus(withdrawal);
  }
}
