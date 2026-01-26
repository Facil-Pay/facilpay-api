import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { AppLogger } from './logger.service';
import { HttpLoggerMiddleware } from './http-logger.middleware';
import { LoggingExceptionFilter } from './logging-exception.filter';
import { LifecycleLoggerService } from './lifecycle-logger.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    AppLogger,
    HttpLoggerMiddleware,
    LifecycleLoggerService,
    {
      provide: APP_FILTER,
      useClass: LoggingExceptionFilter,
    },
  ],
  exports: [AppLogger],
})
export class LoggerModule {}
