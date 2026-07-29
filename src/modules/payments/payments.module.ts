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
import { PaymentQrController } from './payment-qr.controller';
import { MerchantFeeConfig } from './merchant-fee-config.entity';
import { PaymentLinksModule } from '../payment-links/payment-links.module';
import { DisputesService } from './disputes.service';
import { DisputesController } from './disputes.controller';
import { Dispute } from './dispute.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { RecurringPayment } from './recurring-payment.entity';
import { RecurringPaymentsService } from './recurring-payments.service';
import { RecurringPaymentsController } from './recurring-payments.controller';

@Module({
  imports: [
    ConfigModule,
    ScheduleModule.forRoot(),
    TypeOrmModule.forFeature([
      Payment,
      Refund,
      IdempotencyKey,
      PaymentSplit,
      MerchantFeeConfig,
      Dispute,
      RecurringPayment,
    ]),
    WebhooksModule,
    StellarModule,
    MerchantsModule,
    PaymentLinksModule,
    NotificationsModule,
  ],
  controllers: [
    PaymentsController,
    CurrenciesController,
    PaymentQrController,
    DisputesController,
    RecurringPaymentsController,
  ],
  providers: [
    PaymentsService,
    DisputesService,
    WebhookSignatureService,
    WebhookGuard,
    IdempotencyService,
    IdempotencyInterceptor,
    CurrencyConfigService,
    PaymentSseService,
    RecurringPaymentsService,
  ],
  exports: [
    PaymentsService,
    WebhookSignatureService,
    WebhookGuard,
    DisputesService,
  ],
})
export class PaymentsModule {}
