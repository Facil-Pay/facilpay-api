import {
  Injectable,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Logger } from 'pino';
import { AppLogger } from '../logger/logger.service';

@Injectable()
export class DatabaseLoggerService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger: Logger;

  constructor(
    private readonly dataSource: DataSource,
    appLogger: AppLogger,
  ) {
    this.logger = appLogger.child({ module: DatabaseLoggerService.name });
  }

  onApplicationBootstrap() {
    if (this.dataSource.isInitialized) {
      this.logger.info(
        { database: this.dataSource.options.database },
        'Database connection established',
      );
    } else {
      this.logger.error('Database connection not initialized');
    }
  }

  onApplicationShutdown(signal?: string) {
    this.logger.info({ signal }, 'Database connection shutdown');
  }
}
