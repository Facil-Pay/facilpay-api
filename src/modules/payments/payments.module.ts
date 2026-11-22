import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { CustomerPaymentsController } from './customer-payments.controller';
import { Payment } from './payment.entity';
import { PaymentNote } from './payment-note.entity';
import { Invoice } from '../invoices/invoice.entity';
import { Coupon } from '../coupons/coupon.entity';
import { PaymentLink } from '../payment-links/payment-link.entity';
import { CouponsModule } from '../coupons/coupons.module';
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
import { UsersModule } from '../users/users.module';
import { CustomersModule } from '../customers/customers.module';
import { PaymentQrController } from './payment-qr.controller';
import { MerchantFeeConfig } from './merchant-fee-config.entity';
import { MerchantLimit } from '../merchants/entities/merchant-limit.entity';
import { PaymentLinksModule } from '../payment-links/payment-links.module';
import { DisputesService } from './disputes.service';
import { DisputesController } from './disputes.controller';
import { Dispute } from './dispute.entity';
import { DisputeEvidence } from './dispute-evidence.entity';
import { DisputeEvidenceService } from './dispute-evidence.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { RecurringPayment } from './recurring-payment.entity';
import { RecurringPaymentCharge } from './recurring-payment-charge.entity';
import { RecurringPaymentsService } from './recurring-payments.service';
import { RecurringPaymentsController } from './recurring-payments.controller';
import { MerchantFeesController } from './merchant-fees.controller';
import { InvoiceService } from './invoice.service';
import { InvoiceReminder } from './invoice-reminder.entity';
import { InvoiceReminderService } from './invoice-reminder.service';
import { EventsModule } from '../events/events.module';
import { TestModeController } from './test-mode.controller';
import { TestnetOnlyGuard } from './guards/testnet-only.guard';
import { RefundsController } from './refunds.controller';
import { SettlementAdjustment } from '../settlements/entities/settlement-adjustment.entity';
import { MerchantSettings } from '../merchants/entities/merchant-settings.entity';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { PaymentVerificationService } from './payment-verification.service';
import { PaymentVerificationLog } from './entities/payment-verification-log.entity';

@Module({
  imports: [
    ConfigModule,
    ScheduleModule.forRoot(),
    TypeOrmModule.forFeature([
      Payment,
      PaymentNote,
      Invoice,
      Coupon,
      PaymentLink,
      Refund,
      IdempotencyKey,
      PaymentSplit,
      MerchantFeeConfig,
      MerchantLimit,
      Dispute,
      DisputeEvidence,
      RecurringPayment,
      RecurringPaymentCharge,
      SettlementAdjustment,
      InvoiceReminder,
      MerchantSettings,
      PaymentVerificationLog,
    ]),
    WebhooksModule,
    StellarModule,
    MerchantsModule,
    UsersModule,
    CustomersModule,
    PaymentLinksModule,
    CouponsModule,
    NotificationsModule,
    EventsModule,
    AuditLogsModule,
  ],
  controllers: [
    PaymentsController,
    CustomerPaymentsController,
    CurrenciesController,
    PaymentQrController,
    DisputesController,
    RecurringPaymentsController,
    MerchantFeesController,
    RefundsController,
    TestModeController,
  ],
  providers: [
    PaymentsService,
    DisputesService,
    DisputeEvidenceService,
    WebhookSignatureService,
    WebhookGuard,
    IdempotencyService,
    IdempotencyInterceptor,
    CurrencyConfigService,
    PaymentSseService,
    RecurringPaymentsService,
    InvoiceService,
    InvoiceReminderService,
    TestnetOnlyGuard,
    PaymentVerificationService,
  ],
  exports: [
    PaymentsService,
    WebhookSignatureService,
    WebhookGuard,
    DisputesService,
  ],
})
export class PaymentsModule {}
