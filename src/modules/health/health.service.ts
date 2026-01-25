import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class HealthService {
  constructor(private readonly dataSource: DataSource) { }

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
      return { connected: false, message: 'Database not initialized' };
    } catch (error) {
      return {
        connected: false,
        message: error instanceof Error ? error.message : 'Unknown database error',
      };
    }
  }
}
