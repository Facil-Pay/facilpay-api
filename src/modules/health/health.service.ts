import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppLogger } from '../logger/logger.service';
import { Logger } from 'pino';

@Injectable()
export class HealthService {
  private readonly logger: Logger;

  constructor(
    private readonly dataSource: DataSource,
    appLogger: AppLogger,
  ) {
    this.logger = appLogger.child({ module: HealthService.name });
  }

  async check() {
    const dbStatus = await this.checkDatabase();

    return {
      status: dbStatus.connected ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      services: {
        database: dbStatus,
      },
    };
  }

  private async checkDatabase(): Promise<{ connected: boolean; message: string }> {
    try {
      if (this.dataSource.isInitialized) {
        await this.dataSource.query('SELECT 1');
        return { connected: true, message: 'Database connection is healthy' };
      }
      this.logger.warn('Database not initialized');
      return { connected: false, message: 'Database not initialized' };
    } catch (error) {
      this.logger.error(
        { err: error instanceof Error ? error : new Error('Database check failed') },
        'Database health check failed',
      );
      return {
        connected: false,
        message: error instanceof Error ? error.message : 'Unknown database error',
      };
    }
  }
}
