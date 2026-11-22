import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AnchorConfig } from './entities/anchor-config.entity';
import { AnchorWithdrawal } from './entities/anchor-withdrawal.entity';
import { Sep24Service } from './sep24.service';
import { AnchorsController } from './anchors.controller';
import { StellarModule } from '../stellar/stellar.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { EventsModule } from '../events/events.module';
import { AuthModule } from '../auth/auth.module';
import { PaymentsModule } from '../payments/payments.module';
import { UsersModule } from '../users/users.module';
import { Sep31Customer } from './entities/sep31-customer.entity';
import { Sep31Transaction } from './entities/sep31-transaction.entity';
import { Sep31Service } from './sep31.service';
import { Sep31Controller, Sep12CustomerController } from './sep31.controller';

@Module({
  imports: [
    ConfigModule,
    ScheduleModule.forRoot(),
    TypeOrmModule.forFeature([
      AnchorConfig,
      AnchorWithdrawal,
      Sep31Customer,
      Sep31Transaction,
    ]),
    StellarModule,
    WebhooksModule,
    EventsModule,
    AuthModule,
    PaymentsModule,
    UsersModule,
  ],
  controllers: [AnchorsController, Sep31Controller, Sep12CustomerController],
  providers: [Sep24Service, Sep31Service],
  exports: [Sep24Service, Sep31Service],
})
export class AnchorsModule {}
