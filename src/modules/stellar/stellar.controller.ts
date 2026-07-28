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
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiBody,
  ApiParam,
  ApiQuery,
  ApiOkResponse,
  ApiNotFoundResponse,
  ApiBadRequestResponse,
  ApiNoContentResponse,
} from '@nestjs/swagger';
import { StellarService } from './stellar.service';
import { SignTransactionDto } from './dto/sign-transaction.dto';
import { ListTransactionsDto } from './dto/list-transactions.dto';
import { AddTrustlineDto } from './dto/add-trustline.dto';
import { RemoveTrustlineDto } from './dto/remove-trustline.dto';
import { MultiSigTransaction, MultiSigTransactionStatus } from './entities/multi-sig-transaction.entity';
import { StellarAsset } from './entities/stellar-asset.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/user.entity';

@ApiTags('stellar')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard)
@Controller('v1/stellar')
export class StellarController {
  constructor(private readonly stellarService: StellarService) {}

  @Get('transactions')
  @ApiOperation({
    summary: 'List multi-sig transactions',
    description:
      'Returns multi-sig transactions, optionally filtered by status. Each transaction includes its current collected signature count versus the required threshold, so signers can discover which transactions still need their signature.',
  })
  @ApiQuery({ name: 'status', required: false, enum: MultiSigTransactionStatus, description: 'Filter by transaction status.' })
  @ApiOkResponse({
    description: 'List of multi-sig transactions.',
    type: [MultiSigTransaction],
  })
  async listTransactions(@Query() dto: ListTransactionsDto): Promise<MultiSigTransaction[]> {
    return this.stellarService.listTransactions(dto.status);
  }

  @Post('transactions/:id/sign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Add a signature to a multi-sig transaction',
    description: 'Collects and aggregates signatures from multiple signers. If the required threshold is reached, the transaction is submitted.',
  })
  @ApiParam({ name: 'id', description: 'Multi-sig transaction UUID', example: '123e4567-e89b-12d3-a456-426614174000' })
  @ApiBody({ type: SignTransactionDto })
  @ApiOkResponse({
    description: 'Signature added.',
    type: MultiSigTransaction,
  })
  @ApiNotFoundResponse({ description: 'Transaction not found.' })
  @ApiBadRequestResponse({ description: 'Invalid signature or transaction already submitted.' })
  async signTransaction(
    @Param('id') id: string,
    @Body() dto: SignTransactionDto,
  ): Promise<MultiSigTransaction> {
    return this.stellarService.signTransaction(id, dto);
  }

  @Get('assets')
  @ApiOperation({
    summary: 'List configured Stellar assets',
    description: 'Returns all Stellar assets configured for the merchant.',
  })
  @ApiOkResponse({
    description: 'List of configured assets.',
    type: [StellarAsset],
  })
  async listAssets(@CurrentUser() user: User): Promise<StellarAsset[]> {
    return this.stellarService.listAssets(user.id);
  }

  @Post('assets/trustline')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Add trustline to a Stellar asset',
    description: 'Adds a trustline for a Stellar asset and marks it as accepted.',
  })
  @ApiBody({ type: AddTrustlineDto })
  @ApiOkResponse({
    description: 'Trustline added.',
    type: StellarAsset,
  })
  async addTrustline(
    @Body() dto: AddTrustlineDto,
    @CurrentUser() user: User,
  ): Promise<StellarAsset> {
    return this.stellarService.addTrustline(dto, user.id);
  }

  @Delete('assets/trustline')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove trustline for a Stellar asset',
    description: 'Removes a trustline for a Stellar asset.',
  })
  @ApiBody({ type: RemoveTrustlineDto })
  @ApiNoContentResponse({ description: 'Trustline removed.' })
  async removeTrustline(
    @Body() dto: RemoveTrustlineDto,
    @CurrentUser() user: User,
  ): Promise<void> {
    return this.stellarService.removeTrustline(dto, user.id);
  }

  @Get('balances')
  @ApiOperation({
    summary: 'View current balances per asset',
    description: 'Returns current balances for all configured Stellar assets.',
  })
  @ApiOkResponse({
    description: 'Balances per asset.',
  })
  async getBalances(@CurrentUser() user: User): Promise<any> {
    return this.stellarService.getBalances(user.id);
  }

  @Get('mode')
  @ApiOperation({
    summary: 'Get current Stellar network mode',
    description: 'Returns whether the API is running in test or live mode.',
  })
  @ApiOkResponse({
    description: 'Current network mode.',
    schema: {
      example: {
        mode: 'test',
      },
    },
  })
  async getMode() {
    return { mode: this.stellarService.getMode() };
  }

  @Post('fund-testnet')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Fund a testnet account using Friendbot',
    description: 'Funds a Stellar testnet account with test lumens using Friendbot. Only available in testnet mode.',
  })
  @ApiBody({
    schema: {
      example: {
        address: 'GABCD...',
      },
    },
  })
  @ApiOkResponse({
    description: 'Account funded successfully.',
  })
  @ApiBadRequestResponse({
    description: 'Invalid request or not in testnet mode.',
  })
  async fundTestnetAccount(@Body('address') address: string) {
    return this.stellarService.fundTestnetAccount(address);
  }
}
