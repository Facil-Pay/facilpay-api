import {
  Controller,
  Post,
  Body,
  Param,
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
  ApiOkResponse,
  ApiNotFoundResponse,
  ApiBadRequestResponse,
} from '@nestjs/swagger';
import { StellarService } from './stellar.service';
import { SignTransactionDto } from './dto/sign-transaction.dto';
import { MultiSigTransaction } from './entities/multi-sig-transaction.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('stellar')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard)
@Controller('v1/stellar')
export class StellarController {
  constructor(private readonly stellarService: StellarService) {}

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
}
