import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { PaymentWebhookDto } from './dto/payment-webhook.dto';
import { WebhookThrottle } from '../throttler/throttler.decorator';
import { WebhookGuard } from './webhook.guard';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  create(@Body() createPaymentDto: CreatePaymentDto) {
    return this.paymentsService.create(createPaymentDto);
  }

  @Get()
  findAll() {
    return this.paymentsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.paymentsService.findOne(id);
  }

  @WebhookThrottle()
  @UseGuards(WebhookGuard)
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  handleWebhook(@Body() webhookDto: PaymentWebhookDto) {
    return this.paymentsService.handleWebhook(webhookDto);
  }
}
