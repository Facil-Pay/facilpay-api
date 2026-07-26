import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { ScheduleModule } from '@nestjs/schedule';
import { RatesService } from './rates.service';
import { RatesController } from './rates.controller';
import { RatesRedisService } from './rates-redis.service';

@Module({
  imports: [ConfigModule, HttpModule, ScheduleModule.forRoot()],
  controllers: [RatesController],
  providers: [RatesService, RatesRedisService],
  exports: [RatesService],
})
export class RatesModule {}
