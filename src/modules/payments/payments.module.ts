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
  ],
  exports: [PaymentsService, WebhookSignatureService, WebhookGuard],
})
export class PaymentsModule { }
