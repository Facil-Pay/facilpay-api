import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { PaymentLinksService } from '../payment-links/payment-links.service';
import { PaymentsService } from './payments.service';
import * as QRCode from 'qrcode';
import { QrThrottle } from '../throttler/throttler.decorator';
import { buildSep7Uri } from '../stellar/sep7.util';

@ApiTags('payments')
@Controller('v1')
export class PaymentQrController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly paymentLinksService: PaymentLinksService,
  ) {}

  @Get('payments/:id/qr')
  @QrThrottle()
  @ApiOperation({ summary: 'Generate a QR code for a payment' })
  @ApiParam({ name: 'id', description: 'Payment UUID' })
  @ApiQuery({ name: 'size', required: false, example: 300 })
  @ApiQuery({
    name: 'format',
    required: false,
    enum: ['png', 'svg'],
    example: 'png',
  })
  @ApiQuery({
    name: 'data',
    required: false,
    enum: ['payment', 'sep7'],
    example: 'payment',
    description: 'Encode the plain payment data or a SEP-0007 URI',
  })
  async getPaymentQr(
    @Param('id') id: string,
    @Query('size') size = 300,
    @Query('format') format = 'png',
    @Query('data') data = 'payment',
    @Res() res: Response,
  ) {
    const payment = await this.paymentsService.findOne(id);
    const uri =
      data === 'sep7'
        ? buildSep7Uri({
            destination: payment.merchantId ?? 'anonymous',
            amount: payment.amount,
            assetCode: payment.assetCode,
            assetIssuer: payment.assetIssuer,
            memo: payment.description ?? payment.id,
          })
        : `stellar://pay?dest=${payment.merchantId ?? 'anonymous'}&amount=${payment.amount}&memo=${payment.description ?? payment.id}`;
    const buffer = await QRCode.toBuffer(uri, {
      type: format === 'svg' ? 'svg' : 'png',
      width: Number(size) || 300,
    });
    res.setHeader(
      'Content-Type',
      format === 'svg' ? 'image/svg+xml' : 'image/png',
    );
    res.send(buffer);
  }

  @Get('payment-links/:token/qr')
  @QrThrottle()
  @ApiOperation({ summary: 'Generate a QR code for a payment link' })
  @ApiParam({ name: 'token', description: 'Payment link token' })
  @ApiQuery({ name: 'size', required: false, example: 300 })
  @ApiQuery({
    name: 'format',
    required: false,
    enum: ['png', 'svg'],
    example: 'png',
  })
  @ApiQuery({
    name: 'data',
    required: false,
    enum: ['payment', 'sep7'],
    example: 'payment',
    description: 'Encode the plain payment data or a SEP-0007 URI',
  })
  async getPaymentLinkQr(
    @Param('token') token: string,
    @Query('size') size = 300,
    @Query('format') format = 'png',
    @Query('data') data = 'payment',
    @Res() res: Response,
  ) {
    const link = await this.paymentLinksService.findByToken(token);
    const uri =
      data === 'sep7'
        ? buildSep7Uri({
            destination: link.merchantId,
            amount: link.amount,
            assetCode: link.assetCode,
            assetIssuer: link.assetIssuer,
            memo: link.description ?? link.token,
          })
        : `stellar://pay?dest=${link.merchantId}&amount=${link.amount}&memo=${link.description ?? link.token}`;
    const buffer = await QRCode.toBuffer(uri, {
      type: format === 'svg' ? 'svg' : 'png',
      width: Number(size) || 300,
    });
    res.setHeader(
      'Content-Type',
      format === 'svg' ? 'image/svg+xml' : 'image/png',
    );
    res.send(buffer);
  }
}
