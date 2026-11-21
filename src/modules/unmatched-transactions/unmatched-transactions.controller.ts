import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiConflictResponse,
  ApiBadRequestResponse,
  ApiUnauthorizedResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UnmatchedTransactionsService } from './unmatched-transactions.service';
import { ListUnmatchedTransactionsDto } from './dto/list-unmatched-transactions.dto';
import { MatchUnmatchedTransactionDto } from './dto/match-unmatched-transaction.dto';
import { UnmatchedTransaction } from './entities/unmatched-transaction.entity';
import { User } from '../users/user.entity';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Unmatched Transactions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('v1/unmatched-transactions')
export class UnmatchedTransactionsController {
  constructor(private readonly service: UnmatchedTransactionsService) {}

  @Get()
  @ApiOperation({
    summary: 'List unmatched on-chain transactions',
    description:
      'Returns incoming Stellar transactions that could not be matched to a pending payment ' +
      'because the memo was missing or incorrect.',
  })
  @ApiQuery({ name: 'status', required: false, description: 'Filter by status' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  @ApiOkResponse({ description: 'Paginated list of unmatched transactions' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
  async list(@Query() dto: ListUnmatchedTransactionsDto) {
    return this.service.findAll(dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single unmatched transaction' })
  @ApiParam({ name: 'id', type: String, description: 'Unmatched transaction UUID' })
  @ApiOkResponse({ type: UnmatchedTransaction })
  @ApiNotFoundResponse({ description: 'Transaction not found' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
  async getOne(@Param('id', ParseUUIDPipe) id: string): Promise<UnmatchedTransaction> {
    return this.service.findOne(id);
  }

  @Post(':id/match')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Match an unmatched transaction to a payment',
    description:
      'Links the transaction to an existing PENDING payment, completing that payment. ' +
      'A transaction can only be matched once.',
  })
  @ApiParam({ name: 'id', type: String, description: 'Unmatched transaction UUID' })
  @ApiOkResponse({ type: UnmatchedTransaction, description: 'Updated transaction record' })
  @ApiNotFoundResponse({ description: 'Transaction or payment not found' })
  @ApiConflictResponse({ description: 'Transaction already resolved' })
  @ApiBadRequestResponse({ description: 'Target payment is not in PENDING status' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
  async match(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MatchUnmatchedTransactionDto,
    @CurrentUser() user: User,
  ): Promise<UnmatchedTransaction> {
    return this.service.match(id, dto, user.id);
  }

  @Post(':id/refund')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark an unmatched transaction as refunded',
    description:
      'Records that the funds were returned to the sender on-chain. ' +
      'The actual Stellar transaction must be executed separately.',
  })
  @ApiParam({ name: 'id', type: String, description: 'Unmatched transaction UUID' })
  @ApiOkResponse({ type: UnmatchedTransaction, description: 'Updated transaction record' })
  @ApiNotFoundResponse({ description: 'Transaction not found' })
  @ApiConflictResponse({ description: 'Transaction already resolved' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT' })
  async refund(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<UnmatchedTransaction> {
    return this.service.markRefunded(id, user.id);
  }
}
