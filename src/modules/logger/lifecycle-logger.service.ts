import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { Logger } from 'pino';
import { AppLogger } from './logger.service';

@Injectable()
export class LifecycleLoggerService implements OnApplicationShutdown {
  private readonly logger: Logger;

  constructor(appLogger: AppLogger) {
    this.logger = appLogger.child({ module: LifecycleLoggerService.name });
  }

  onApplicationShutdown(signal?: string) {
    this.logger.info({ signal }, 'Application shutdown');
  }
}
