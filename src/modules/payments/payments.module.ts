import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { Payment } from './payment.entity';
import { Refund } from './refund.entity';
import { Dispute } from './dispute.entity';
import { WebhookSignatureService } from './webhook-signature.service';
import { WebhookGuard } from './webhook.guard';
import { IdempotencyKey } from './idempotency.entity';
import { IdempotencyService } from './idempotency.service';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { CurrencyConfigService } from './currency-config.service';
import { CurrenciesController } from './currencies.controller';
import { PaymentSseService } from './payment-sse.service';
import { DisputesController } from './disputes.controller';
import { DisputesService } from './disputes.service';

@Module({
  imports: [ConfigModule, TypeOrmModule.forFeature([Payment, Refund, IdempotencyKey, Dispute])],
  controllers: [PaymentsController, CurrenciesController, DisputesController],
  providers: [
    PaymentsService,
    DisputesService,
    WebhookSignatureService,
    WebhookGuard,
    IdempotencyService,
    IdempotencyInterceptor,
    CurrencyConfigService,
    PaymentSseService,
  ],
  exports: [PaymentsService, WebhookSignatureService, WebhookGuard, DisputesService],
})
export class PaymentsModule {}

