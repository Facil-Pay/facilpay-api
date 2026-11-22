import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Request,
  Query,
  Res,
  BadRequestException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiOkResponse,
  ApiUnauthorizedResponse,
  ApiNotFoundResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { SettlementsService } from './settlements.service';
import { UpsertSettlementConfigDto } from './dto/upsert-settlement-config.dto';
import { GetSettlementsDto } from './dto/get-settlements.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../../common/constants/roles';
import {
  createSettlementStatementPdfDocument,
  csvEscape,
  writeSettlementStatementPdfTable,
} from '../payments/export/payments-exporter';

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

  @Get('preview')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Estimate the next settlement, fees, refunds and reserve per currency' })
  preview(@Request() req: any) {
    return this.service.preview(req.user.id);
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

  @Get(':id/statement')
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Download a settlement statement',
    description:
      'Downloads a CSV or PDF reconciliation statement containing the settlement header, included payments, fees, refunds, and adjustments. The settlement owner or an administrator may access it.',
  })
  @ApiParam({ name: 'id', description: 'Settlement UUID' })
  @ApiQuery({ name: 'format', enum: ['pdf', 'csv'], required: true })
  @ApiOkResponse({ description: 'Downloadable settlement statement.' })
  async statement(
    @Param('id') id: string,
    @Query('format') format: string,
    @Request() req: any,
    @Res() res: Response,
  ): Promise<void> {
    if (format !== 'pdf' && format !== 'csv') {
      throw new BadRequestException('format must be pdf or csv');
    }

    const isAdmin = (req.user.roles || []).includes(UserRole.ADMIN);
    const statement = await this.service.getSettlementStatement(
      id,
      req.user.id,
      isAdmin,
    );
    const period = `${statement.period.from?.toISOString() ?? 'N/A'} to ${statement.period.to.toISOString()}`;

    if (format === 'csv') {
      const lines = [
        ['merchant', statement.merchant],
        ['period', period],
        ['currency', statement.settlement.currency],
        ['transactionHash', statement.settlement.transactionHash],
        [],
        ['paymentId', 'reference', 'gross', 'fee', 'net', 'refunds', 'adjustments'],
        ...statement.rows.map((row) => [
          row.paymentId,
          row.reference,
          row.gross.toFixed(2),
          row.fee.toFixed(2),
          row.net.toFixed(2),
          row.refunds.toFixed(2),
          row.adjustments.toFixed(2),
        ]),
        ['TOTAL', '', statement.totals.gross.toFixed(2), statement.totals.fee.toFixed(2), statement.totals.net.toFixed(2), statement.totals.refunds.toFixed(2), statement.totals.adjustments.toFixed(2)],
        ['settlementAmount', '', '', '', Number(statement.settlement.totalAmount).toFixed(2)],
      ];
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="settlement-${id}.csv"`);
      res.send(lines.map((line) => line.map(csvEscape).join(',')).join('\n'));
      return;
    }

    const doc = createSettlementStatementPdfDocument({
      merchant: statement.merchant,
      period,
      currency: statement.settlement.currency,
      transactionHash: statement.settlement.transactionHash,
      settlementAmount: Number(statement.settlement.totalAmount),
    });
    writeSettlementStatementPdfTable(doc, statement.rows, statement.totals);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="settlement-${id}.pdf"`);
    doc.pipe(res);
    doc.end();
  }

  @Get(':id/adjustments')
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'List post-settlement refund adjustments for a settlement',
    description:
      'Returns adjustments created when a payment already included in this settlement is later refunded.',
  })
  @ApiParam({ name: 'id', description: 'Settlement UUID' })
  @ApiOkResponse({ description: 'Settlement adjustments.' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT.' })
  @ApiNotFoundResponse({ description: 'Settlement not found.' })
  findAdjustments(@Param('id') id: string, @Request() req: any) {
    return this.service.findAdjustmentsForSettlement(req.user.id, id);
  }
}
