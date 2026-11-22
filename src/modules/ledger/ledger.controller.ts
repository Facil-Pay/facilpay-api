import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { LedgerService } from './ledger.service';
import { GetLedgerEntriesDto } from './dto/get-ledger-entries.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/user.entity';
import { BalanceHistoryDto } from './dto/balance-history.dto';

@ApiTags('ledger')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard)
@Controller('v1/merchants/me')
export class LedgerController {
  constructor(private readonly ledgerService: LedgerService) {}

  @Get('balance/history')
  @ApiOperation({ summary: 'Daily closing available balances in the merchant timezone (cached 60 seconds)' })
  getHistory(@CurrentUser() user: User, @Query() dto: BalanceHistoryDto) {
    return this.ledgerService.getHistory(user.id, dto);
  }

  @Get('balance')
  @ApiOperation({
    summary: 'Get merchant ledger balances',
    description:
      'Returns balance totals grouped by currency and ledger account for the authenticated merchant.',
  })
  @ApiQuery({ name: 'currency', required: false, example: 'USD' })
  @ApiOkResponse({
    description: 'Current ledger balances.',
    schema: {
      example: {
        merchantId: '550e8400-e29b-41d4-a716-446655440000',
        balances: [
          { currency: 'USD', account: 'AVAILABLE', balance: '92.50' },
          { currency: 'USD', account: 'FEES', balance: '7.50' },
          { currency: 'USD', account: 'PENDING', balance: '0' },
          { currency: 'USD', account: 'PAYOUT', balance: '0' },
        ],
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT.' })
  getBalance(@CurrentUser() user: User, @Query('currency') currency?: string) {
    return this.ledgerService.getBalance(user.id, currency);
  }

  @Get('ledger')
  @ApiOperation({
    summary: 'List merchant ledger entries',
    description:
      'Returns immutable ledger entries for the authenticated merchant, newest first, with optional filters and pagination. ' +
      'Pass `format=csv` with `from` and `to` to download the range as CSV instead (oldest first, columns: ' +
      'id, createdAt, currency, account, amount, referenceType, referenceId, transactionId). ' +
      'Ranges of more than 5000 entries are refused; run those as a background job with `POST /v1/exports` and `resource: "ledger"`.',
  })
  @ApiProduces('application/json', 'text/csv')
  @ApiOkResponse({
    description: 'Paginated ledger entries.',
    schema: {
      example: {
        data: [
          {
            id: '76074025-a1b5-45b2-8ca4-138d1534444d',
            merchantId: '550e8400-e29b-41d4-a716-446655440000',
            currency: 'USD',
            account: 'AVAILABLE',
            amount: '92.50000000',
            referenceType: 'PAYMENT',
            referenceId: '123e4567-e89b-12d3-a456-426614174000',
            transactionId: '4d827b42-99d1-4a1e-9cf2-fb537f531111',
            createdAt: '2026-09-25T10:05:00.000Z',
          },
        ],
        total: 1,
        page: 1,
        limit: 20,
      },
    },
  })
  @ApiBadRequestResponse({
    description:
      'For `format=csv`: `from` or `to` missing, `from` after `to`, or the range holds more than 5000 entries.',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT.' })
  async findLedger(
    @CurrentUser() user: User,
    @Query() dto: GetLedgerEntriesDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (dto.format === 'csv') {
      const csv = await this.ledgerService.exportCsv(user.id, dto);
      res.set({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="ledger-export.csv"',
      });
      return csv;
    }
    return this.ledgerService.findLedger(user.id, dto);
  }
}
