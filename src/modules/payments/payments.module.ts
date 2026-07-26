import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { Payment } from './payment.entity';
import { Refund } from './refund.entity';
import { PaymentSplit } from './payment-split.entity';
import { WebhookSignatureService } from './webhook-signature.service';
import { WebhookGuard } from './webhook.guard';
import { IdempotencyKey } from './idempotency.entity';
import { IdempotencyService } from './idempotency.service';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { CurrencyConfigService } from './currency-config.service';
import { CurrenciesController } from './currencies.controller';
import { PaymentSseService } from './payment-sse.service';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { StellarModule } from '../stellar/stellar.module';
import { MerchantsModule } from '../merchants/merchants.module';

@Module({
  imports: [
    ConfigModule,
    ScheduleModule.forRoot(),
    TypeOrmModule.forFeature([Payment, Refund, IdempotencyKey, PaymentSplit]),
    WebhooksModule,
    StellarModule,
    MerchantsModule,
  ],
  controllers: [PaymentsController, CurrenciesController],
  providers: [
    PaymentsService,
    WebhookSignatureService,
    WebhookGuard,
    IdempotencyService,
    IdempotencyInterceptor,
    CurrencyConfigService,
    PaymentSseService,
  ],
  exports: [PaymentsService, WebhookSignatureService, WebhookGuard],
})
export class PaymentsModule {}

