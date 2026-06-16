import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { Payment } from './payment.entity';
import { Refund } from './refund.entity';
import { WebhookSignatureService } from './webhook-signature.service';
import { WebhookGuard } from './webhook.guard';
import { IdempotencyKey } from './idempotency.entity';
import { IdempotencyService } from './idempotency.service';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { CurrencyConfigService } from './currency-config.service';
import { CurrenciesController } from './currencies.controller';
import { ExportService } from './export.service';


@Module({
  imports: [TypeOrmModule.forFeature([Payment, Refund, IdempotencyKey])],
  controllers: [PaymentsController, CurrenciesController],

  providers: [
    PaymentsService,
    WebhookSignatureService,
    WebhookGuard,
    IdempotencyService,
    IdempotencyInterceptor,
    CurrencyConfigService,
    ExportService,
  ],
  exports: [PaymentsService, WebhookSignatureService, WebhookGuard, ExportService],
})
export class PaymentsModule { }
