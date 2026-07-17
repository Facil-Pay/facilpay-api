import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { Payment } from '../payments/payment.entity';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { AnalyticsCacheService } from './analytics-cache.service';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([Payment]),
  ],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, AnalyticsCacheService],
})
export class AnalyticsModule {}
