import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { MaintenanceService } from './maintenance.service';
import { MaintenanceScheduler } from './maintenance.scheduler';
import { LoggerModule } from '../logger/logger.module';

@Module({
  imports: [ScheduleModule, LoggerModule],
  providers: [MaintenanceService, MaintenanceScheduler],
  exports: [MaintenanceService],
})
export class MaintenanceModule {}
