import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  HttpCode,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '../../common/constants/roles';
import { User } from '../users/user.entity';
import { PayoutsService } from './payouts.service';
import { CreatePayoutDto } from './dto/create-payout.dto';
import { ListPayoutsDto, PayoutBalanceQueryDto } from './dto/list-payouts.dto';
import { SetPayoutLimitDto } from './dto/set-payout-limit.dto';
import { Payout } from './entities/payout.entity';

@ApiTags('payouts')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard)
@Controller('v1/payouts')
export class PayoutsController {
  constructor(private readonly payoutsService: PayoutsService) {}

  @Post()
  @UseGuards(PermissionsGuard)
  @Permissions('payouts:create')
  @ApiOperation({
    summary: 'Send a payout to a third-party Stellar address',
    description:
      'Requires the `payouts:create` permission and a valid X-Step-Up-Token. The destination must exist, trust the asset and, if it sets `config.memo_required`, a memo must be provided. The amount is reserved against the available balance immediately and returned if the payout fails.',
  })
  @ApiHeader({ name: 'X-Step-Up-Token', required: true, description: 'Token from POST /v1/auth/step-up' })
  @ApiCreatedResponse({ description: 'Payout accepted and queued.', type: Payout })
  @ApiBadRequestResponse({ description: 'Invalid destination, insufficient balance or daily limit exceeded.' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid step-up token.' })
  @ApiForbiddenResponse({ description: 'Missing payouts:create permission.' })
  @ApiConflictResponse({ description: 'Reference already used.' })
  create(
    @CurrentUser() user: User,
    @Body() dto: CreatePayoutDto,
    @Headers('x-step-up-token') stepUpToken: string,
    @Req() req: Request,
  ): Promise<Payout> {
    return this.payoutsService.create(
      user.id,
      dto,
      stepUpToken,
      req.ip,
      req.headers['user-agent'],
    );
  }

  @Post('bulk')
  @UseGuards(PermissionsGuard)
  @Permissions('payouts:create')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 1024 * 1024 } }))
  @ApiOperation({ summary: 'Upload a CSV of payouts (multipart field: file)' })
  createBulk(
    @CurrentUser() user: User,
    @UploadedFile() file: { buffer: Buffer } | undefined,
    @Headers('x-step-up-token') token: string,
  ) {
    if (!file?.buffer) throw new BadRequestException('CSV file is required');
    return this.payoutsService.createBulk(user.id, file.buffer.toString('utf8'), token);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @UseGuards(PermissionsGuard)
  @Permissions('payouts:create')
  @ApiOperation({ summary: 'Cancel a pending payout and release its balance' })
  cancel(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.payoutsService.cancel(user.id, id);
  }

  @Get()
  @ApiOperation({ summary: 'List payouts for the authenticated merchant' })
  @ApiOkResponse({ description: 'Paginated payouts.' })
  findAll(@CurrentUser() user: User, @Query() query: ListPayoutsDto) {
    return this.payoutsService.findAll(user.id, query);
  }

  @Get('balance')
  @ApiOperation({
    summary: 'Get the balance available for payouts',
    description: 'Credited payments minus settlements and pending/submitted/completed payouts.',
  })
  @ApiOkResponse({ description: 'Available balance.' })
  getBalance(@CurrentUser() user: User, @Query() query: PayoutBalanceQueryDto) {
    return this.payoutsService.getBalance(user.id, query.currency);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a payout' })
  @ApiOkResponse({ description: 'Payout found.', type: Payout })
  @ApiNotFoundResponse({ description: 'Payout not found.' })
  findOne(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Payout> {
    return this.payoutsService.findOne(user.id, id);
  }
}

@ApiTags('admin')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('v1/admin/payouts')
export class AdminPayoutsController {
  constructor(private readonly payoutsService: PayoutsService) {}

  @Patch('limits')
  @ApiOperation({
    summary: 'Set a merchant daily payout limit (admin)',
    description: 'Overrides PAYOUT_DAILY_LIMIT for one merchant and currency. Send dailyLimit: null to reset.',
  })
  @ApiOkResponse({ description: 'Limit updated.' })
  @ApiForbiddenResponse({ description: 'Admin role required.' })
  setLimit(@Body() dto: SetPayoutLimitDto) {
    return this.payoutsService.setDailyLimit(dto.merchantId, dto.currency, dto.dailyLimit);
  }
}
