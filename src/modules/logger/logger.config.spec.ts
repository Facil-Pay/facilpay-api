import { ConfigService } from '@nestjs/config';
import { join } from 'node:path';
import { buildLoggerConfig, buildTransportTargets } from './logger.config';

describe('logger config', () => {
  it('builds file transport targets', () => {
    const configService = {
      get: (key: string, defaultValue?: string) => {
        const values: Record<string, string> = {
          NODE_ENV: 'production',
          LOG_LEVEL: 'info',
          LOG_DIR: 'test-logs',
          LOG_MAX_SIZE: '5m',
          LOG_RETENTION_DAYS: '7',
          LOG_PRETTY: 'false',
          SERVICE_NAME: 'facilpay-api',
        };

        return values[key] ?? defaultValue;
      },
    } as ConfigService;

    const config = buildLoggerConfig(configService);
    const targets = buildTransportTargets(config);

    const combinedTarget = targets.find(
      (target) =>
        target.target === 'pino-roll' &&
        String(target.options?.file).includes('combined'),
    );
    const errorTarget = targets.find(
      (target) =>
        target.target === 'pino-roll' &&
        String(target.options?.file).includes('error'),
    );

    expect(combinedTarget?.options?.file).toBe(
      join(config.logDir, 'combined.log'),
    );
    expect(errorTarget?.options?.file).toBe(join(config.logDir, 'error.log'));
  });
});
