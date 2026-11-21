import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiBody,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { CreateSep31TransactionDto } from './dto/create-sep31-transaction.dto';
import { UpdateSep12CustomerDto } from './dto/update-sep12-customer.dto';
import { Sep31Service } from './sep31.service';

@ApiTags('SEP-31 Cross-Border Payments')
@Controller('v1/sep31')
export class Sep31Controller {
  constructor(private readonly sep31Service: Sep31Service) {}

  @Get('info')
  @ApiOperation({ summary: 'List assets and customer information supported by SEP-31' })
  @ApiOkResponse({ description: 'Supported assets and SEP-12 customer types.' })
  async info() {
    return this.sep31Service.getInfo();
  }

  @Post('transactions')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a SEP-31 receiving transaction' })
  @ApiCreatedResponse({ description: 'SEP-31 transaction created.', schema: { example: { id: 'uuid' } } })
  @ApiForbiddenResponse({ description: 'Invalid or unauthorized SEP-10 token.' })
  async createTransaction(
    @Headers('authorization') authorization: string | undefined,
    @Body() dto: CreateSep31TransactionDto,
  ) {
    const senderAccount = await this.sep31Service.authenticate(authorization);
    return this.sep31Service.createTransaction(senderAccount, dto);
  }

  @Get('transactions/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the status and Stellar payment details for a SEP-31 transaction' })
  @ApiOkResponse({ description: 'Current SEP-31 transaction.' })
  @ApiNotFoundResponse({ description: 'Transaction not found.' })
  @ApiForbiddenResponse({ description: 'Invalid or unauthorized SEP-10 token.' })
  async getTransaction(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') id: string,
  ) {
    const senderAccount = await this.sep31Service.authenticate(authorization);
    return this.sep31Service.getTransaction(senderAccount, id);
  }

}

@ApiTags('SEP-12 Customer Information')
@ApiBearerAuth()
@Controller('v1/sep12')
export class Sep12CustomerController {
  constructor(private readonly sep31Service: Sep31Service) {}

  @Get('customer')
  @ApiOperation({ summary: 'Get this sending anchor customer’s SEP-12 status and fields' })
  @ApiOkResponse({ description: 'SEP-12 customer data.' })
  @ApiForbiddenResponse({ description: 'Invalid or unauthorized SEP-10 token.' })
  @ApiQuery({ name: 'id', required: false })
  @ApiQuery({ name: 'transaction_id', required: false })
  @ApiQuery({ name: 'type', required: true, enum: ['sep31_sender', 'sep31_receiver'] })
  async getCustomer(
    @Headers('authorization') authorization: string | undefined,
    @Query('id') id: string | undefined,
    @Query('type') type: string,
    @Query('transaction_id') transactionId?: string,
  ) {
    const senderAccount = await this.sep31Service.authenticate(authorization);
    return this.sep31Service.getCustomer(senderAccount, id, type, transactionId);
  }

  @Put('customer')
  @ApiOperation({ summary: 'Register or update a SEP-12 customer' })
  @ApiOkResponse({ description: 'Customer accepted.' })
  @ApiForbiddenResponse({ description: 'Invalid or unauthorized SEP-10 token.' })
  @ApiQuery({ name: 'type', required: true, enum: ['sep31_sender', 'sep31_receiver'] })
  @ApiQuery({ name: 'id', required: false })
  @ApiQuery({ name: 'transaction_id', required: false })
  @ApiQuery({ name: 'merchant_id', required: false, description: 'FacilPay extension required for receiver registration.' })
  @ApiBody({ schema: { type: 'object', additionalProperties: true } })
  async updateCustomer(
    @Headers('authorization') authorization: string | undefined,
    @Query('type') type: UpdateSep12CustomerDto['type'],
    @Query('id') id: string | undefined,
    @Query('transaction_id') transactionId: string | undefined,
    @Query('merchant_id') merchantId: string | undefined,
    @Body() fields: Record<string, unknown>,
  ) {
    const senderAccount = await this.sep31Service.authenticate(authorization);
    return this.sep31Service.updateCustomer(senderAccount, {
      type,
      id,
      transaction_id: transactionId,
      merchant_id: merchantId,
      fields,
    });
  }
}
