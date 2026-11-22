import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { PaymentsService } from './payments.service';
import { RejectRefundDto } from './dto/reject-refund.dto';
import { GetRefundsDto } from './dto/get-refunds.dto';

@ApiTags('refunds')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard)
@Controller('v1/refunds')
export class RefundsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get()
  @ApiOperation({
    summary: 'List refunds for the authenticated merchant',
    description:
      'Returns a paginated list of refunds belonging to the authenticated merchant, with optional filters.',
  })
  @ApiOkResponse({ description: 'Paginated list of merchant refunds.' })
  list(@Query() query: GetRefundsDto, @Request() req: any) {
    return this.paymentsService.listRefunds(req.user.id, query);
  }

  @Get('report')
  @ApiOperation({
    summary: 'Get refund report',
    description:
      'Returns refund counts and amounts grouped by reason code and currency.',
  })
  @ApiQuery({
    name: 'from',
    required: false,
    type: String,
    format: 'date-time',
  })
  @ApiQuery({ name: 'to', required: false, type: String, format: 'date-time' })
  getReport(@Query('from') from?: string, @Query('to') to?: string) {
    const fromDate = this.parseDate(from, 'from');
    const toDate = this.parseDate(to, 'to');

    if (fromDate && toDate && fromDate > toDate) {
      throw new BadRequestException('from must be before or equal to to');
    }

    return this.paymentsService.getRefundReport(
      fromDate?.toISOString(),
      toDate?.toISOString(),
    );
  }

  private parseDate(value: string | undefined, name: string): Date | undefined {
    if (!value) return undefined;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`${name} must be a valid ISO date`);
    }
    return date;
  }

  @Post(':id/approve')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('refunds:approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Approve a pending refund',
    description:
      'Approves a refund that is awaiting maker-checker approval and executes the fund movement. ' +
      'Requires the `refunds:approve` permission. The approver cannot be the same user who initiated the refund.',
  })
  @ApiParam({ name: 'id', description: 'Refund UUID' })
  @ApiOkResponse({ description: 'Refund approved and executed.' })
  @ApiNotFoundResponse({ description: 'Refund not found.' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions or self-approval attempted.' })
  async approve(@Param('id') id: string, @Request() req: any) {
    return this.paymentsService.approveRefund(id, req.user.id);
  }

  @Post(':id/reject')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('refunds:approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reject a pending refund',
    description:
      'Rejects a refund that is awaiting maker-checker approval. ' +
      'Requires the `refunds:approve` permission.',
  })
  @ApiParam({ name: 'id', description: 'Refund UUID' })
  @ApiBody({ type: RejectRefundDto })
  @ApiOkResponse({ description: 'Refund rejected.' })
  @ApiNotFoundResponse({ description: 'Refund not found.' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions.' })
  async reject(
    @Param('id') id: string,
    @Body() dto: RejectRefundDto,
    @Request() req: any,
  ) {
    return this.paymentsService.rejectRefund(id, req.user.id, dto);
  }
}