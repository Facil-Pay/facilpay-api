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
        target.target === 'pino/file' &&
        String(target.options?.destination).includes('combined'),
    );
    const errorTarget = targets.find(
      (target) =>
        target.target === 'pino/file' &&
        String(target.options?.destination).includes('error'),
    );

    expect(combinedTarget?.options?.destination).toBe(
      join(config.logDir, 'combined.log'),
    );
    expect(errorTarget?.options?.destination).toBe(
      join(config.logDir, 'error.log'),
    );
  });
});
import { ConfigService } from '@nestjs/config';
import { resolve, join } from 'node:path';

export interface LoggerConfig {
  environment: string;
  level: string;
  pretty: boolean;
  logDir: string;
  maxSize?: string;
  retentionDays: number;
  service: string;
}

export interface TransportTarget {
  target: string;
  level?: string;
  options?: Record<string, unknown>;
}

const DEFAULT_RETENTION_DAYS = 14;
const DEFAULT_MAX_SIZE = '10m';

export function buildLoggerConfig(configService: ConfigService): LoggerConfig {
  const environment = configService.get<string>('NODE_ENV', 'development');
  const levelDefault = environment === 'production' ? 'info' : 'debug';
  const level = configService.get<string>('LOG_LEVEL', levelDefault);

  const prettyDefault = environment !== 'production';
  const pretty = parseBoolean(
    configService.get<string>('LOG_PRETTY'),
    prettyDefault,
  );

  const logDir = resolve(configService.get<string>('LOG_DIR', 'logs'));
  const maxSize =
    configService.get<string>('LOG_MAX_SIZE', DEFAULT_MAX_SIZE) || undefined;
  const retentionDays = parseNumber(
    configService.get<string>('LOG_RETENTION_DAYS'),
    DEFAULT_RETENTION_DAYS,
  );
  const service = configService.get<string>('SERVICE_NAME', 'facilpay-api');

  return {
    environment,
    level,
    pretty,
    logDir,
    maxSize,
    retentionDays,
    service,
  };
}

export function buildTransportTargets(config: LoggerConfig): TransportTarget[] {
  const fileTarget = resolveFileTransportTarget();
  const rotationOptions: Record<string, unknown> = {
    frequency: 'daily',
    mkdir: true,
  };

  if (config.maxSize) {
    rotationOptions.size = config.maxSize;
  }

  if (config.retentionDays > 0) {
    rotationOptions.limit = { count: config.retentionDays };
  }

  const targets: TransportTarget[] = [
    {
      target: fileTarget,
      level: config.level,
      options: buildFileTransportOptions(
        fileTarget,
        join(config.logDir, 'combined.log'),
        rotationOptions,
      ),
    },
    {
      target: fileTarget,
      level: 'error',
      options: buildFileTransportOptions(
        fileTarget,
        join(config.logDir, 'error.log'),
        rotationOptions,
      ),
    },
  ];

  if (config.pretty && isTransportAvailable('pino-pretty')) {
    targets.push({
      target: 'pino-pretty',
      level: config.level,
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        singleLine: true,
        ignore: 'pid,hostname',
      },
    });
  }

  return targets;
}

function resolveFileTransportTarget(): string {
  return isTransportAvailable('pino-roll') ? 'pino-roll' : 'pino/file';
}

function buildFileTransportOptions(
  target: string,
  filePath: string,
  rotationOptions: Record<string, unknown>,
): Record<string, unknown> {
  if (target === 'pino-roll') {
    return {
      ...rotationOptions,
      file: filePath,
    };
  }

  return {
    destination: filePath,
    mkdir: true,
  };
}

function isTransportAvailable(target: string): boolean {
  if (target === 'pino/file') {
    return true;
  }

  try {
    require.resolve(target);
    return true;
  } catch {
    return false;
  }
}

function parseBoolean(
  value: string | undefined,
  defaultValue: boolean,
): boolean {
  if (value === undefined) {
    return defaultValue;
  }

  return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
}

function parseNumber(value: string | undefined, defaultValue: number): number {
  if (!value) {
    return defaultValue;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}
