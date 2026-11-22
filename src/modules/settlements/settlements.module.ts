import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule } from '@nestjs/config';
import { Settlement } from './entities/settlement.entity';
import { SettlementAdjustment } from './entities/settlement-adjustment.entity';
import { MerchantSettlementConfig } from './entities/merchant-settlement-config.entity';
import { SettlementsService } from './settlements.service';
import { SettlementsController } from './settlements.controller';
import { AdminSettlementsController } from './admin-settlements.controller';
import { UsersModule } from '../users/users.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { EventsModule } from '../events/events.module';
import { Payment } from '../payments/payment.entity';
import { MailService } from '../auth/mail/mail.service';
import { PayoutDestination } from './entities/payout-destination.entity';
import { StellarModule } from '../stellar/stellar.module';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { AuthModule } from '../auth/auth.module';
import { PayoutDestinationsController } from './payout-destinations.controller';
import { Refund } from '../payments/refund.entity';

@Module({
  imports: [
    ConfigModule,
    AuthModule,
    StellarModule,
    AuditLogsModule,
    ScheduleModule.forRoot(),
    TypeOrmModule.forFeature([
      Settlement,
      SettlementAdjustment,
      MerchantSettlementConfig,
      Payment,
      PayoutDestination,
      Refund,
    ]),
    UsersModule,
    WebhooksModule,
    EventsModule,
  ],
  controllers: [SettlementsController, AdminSettlementsController, PayoutDestinationsController],
  providers: [SettlementsService, MailService],
  exports: [SettlementsService],
})
export class SettlementsModule {}
