import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule } from '@nestjs/config';
import { Settlement } from './entities/settlement.entity';
import { MerchantSettlementConfig } from './entities/merchant-settlement-config.entity';
import { SettlementsService } from './settlements.service';
import { SettlementsController } from './settlements.controller';
import { AdminSettlementsController } from './admin-settlements.controller';
import { UsersModule } from '../users/users.module';
import { Payment } from '../payments/payment.entity';
import { MailService } from '../auth/mail/mail.service';

@Module({
  imports: [
    ConfigModule,
    ScheduleModule.forRoot(),
    TypeOrmModule.forFeature([Settlement, MerchantSettlementConfig, Payment]),
    UsersModule,
  ],
  controllers: [SettlementsController, AdminSettlementsController],
  providers: [SettlementsService, MailService],
})
export class SettlementsModule {}
