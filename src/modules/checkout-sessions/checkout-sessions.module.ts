import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { CheckoutSession } from './entities/checkout-session.entity';
import { CheckoutSessionsService } from './checkout-sessions.service';
import { CheckoutSessionsController, CheckoutSessionsPublicController } from './checkout-sessions.controller';
import { MerchantsModule } from '../merchants/merchants.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { PaymentsModule } from '../payments/payments.module';
import { ProductsModule } from '../products/products.module';
import { CouponsModule } from '../coupons/coupons.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CheckoutRecoveryService } from './checkout-recovery.service';

@Module({
  imports: [
    ConfigModule,
    ScheduleModule.forRoot(),
    TypeOrmModule.forFeature([CheckoutSession]),
    MerchantsModule,
    WebhooksModule,
    PaymentsModule,
    ProductsModule,
    CouponsModule,
    NotificationsModule,
  ],
  controllers: [CheckoutSessionsController, CheckoutSessionsPublicController],
  providers: [CheckoutSessionsService, CheckoutRecoveryService],
  exports: [CheckoutSessionsService, CheckoutRecoveryService],
})
export class CheckoutSessionsModule {}