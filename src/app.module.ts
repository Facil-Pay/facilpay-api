import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DatabaseModule } from './modules/database/database.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { PaymentLinksModule } from './modules/payment-links/payment-links.module';
import { SettlementsModule } from './modules/settlements/settlements.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { LoggerModule } from './modules/logger/logger.module';
import { HttpLoggerMiddleware } from './modules/logger/http-logger.middleware';
import { ThrottlerConfigModule } from './modules/throttler/throttler.config.module';
import { StellarModule } from './modules/stellar/stellar.module';
import { BullModule } from '@nestjs/bullmq';
import { CorsModule } from './modules/cors/cors.module';
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { RatesModule } from './modules/rates/rates.module';
import { MerchantsModule } from './modules/merchants/merchants.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { SessionsModule } from './modules/sessions/sessions.module';
import { CheckoutSessionsModule } from './modules/checkout-sessions/checkout-sessions.module';
import { SecurityHeadersMiddleware } from './common/middleware/security-headers.middleware';
import { AuditLogsModule } from './modules/audit-logs/audit-logs.module';
import { EventsModule } from './modules/events/events.module';
import { ReportsModule } from './modules/reports/reports.module';
import { PayoutsModule } from './modules/payouts/payouts.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { CouponsModule } from './modules/coupons/coupons.module';
import { TeamModule } from './modules/team/team.module';

import { AdminMetricsModule } from './modules/admin/admin-metrics.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get('REDIS_HOST', 'localhost'),
          port: configService.get('REDIS_PORT', 6379),
        },
      }),
    }),
    ThrottlerConfigModule,
    LoggerModule,
    CorsModule,
    MetricsModule,
    MaintenanceModule,
    DatabaseModule,
    HealthModule,
    UsersModule,
    AuthModule,
    PaymentsModule,
    PaymentLinksModule,
    SettlementsModule,
    WebhooksModule,
    StellarModule,
    ApiKeysModule,
    NotificationsModule,
    RatesModule,
    MerchantsModule,
    OnboardingModule,
    AuditLogsModule,
    EventsModule,
    ReportsModule,
    PayoutsModule,
    AnalyticsModule,
    InvoicesModule,
    CouponsModule,
    TeamModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(SecurityHeadersMiddleware, HttpLoggerMiddleware, HttpMetricsMiddleware).forRoutes('*');
  }
}
