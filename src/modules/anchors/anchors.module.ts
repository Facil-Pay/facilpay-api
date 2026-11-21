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

@Module({
  imports: [
    ConfigModule,
    ScheduleModule.forRoot(),
    TypeOrmModule.forFeature([AnchorConfig, AnchorWithdrawal]),
    StellarModule,
    WebhooksModule,
    EventsModule,
    AuthModule,
  ],
  controllers: [AnchorsController],
  providers: [Sep24Service],
  exports: [Sep24Service],
})
export class AnchorsModule {}
