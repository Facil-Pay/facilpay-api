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
  const pretty = parseBoolean(configService.get<string>('LOG_PRETTY'), prettyDefault);

  const logDir = resolve(configService.get<string>('LOG_DIR', 'logs'));
  const maxSize = configService.get<string>('LOG_MAX_SIZE', DEFAULT_MAX_SIZE) || undefined;
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
      target: 'pino-roll',
      level: config.level,
      options: {
        ...rotationOptions,
        file: join(config.logDir, 'combined.log'),
      },
    },
    {
      target: 'pino-roll',
      level: 'error',
      options: {
        ...rotationOptions,
        file: join(config.logDir, 'error.log'),
      },
    },
  ];

  if (config.pretty) {
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

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
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
