import { Injectable, LoggerService } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdirSync } from 'node:fs';
import pino, { Logger } from 'pino';
import { buildLoggerConfig, buildTransportTargets } from './logger.config';
import { getCorrelationId } from './correlation-id.context';

@Injectable()
export class AppLogger implements LoggerService {
  private readonly logger: Logger;

  constructor(private readonly configService: ConfigService) {
    const config = buildLoggerConfig(this.configService);
    mkdirSync(config.logDir, { recursive: true });

    const transport = pino.transport({
      targets: buildTransportTargets(config),
    });

    this.logger = pino(
      {
        level: config.level,
        base: {
          service: config.service,
          environment: config.environment,
        },
        timestamp: pino.stdTimeFunctions.isoTime,
        formatters: {
          level(label) {
            return { level: label };
          },
        },
      },
      transport,
    );
  }

  child(bindings: Record<string, unknown>): Logger {
    return this.logger.child(bindings);
  }

  getLogger(): Logger {
    return this.logger;
  }

  log(message: any, context?: string) {
    this.logger.info({ context, correlationId: getCorrelationId() }, message);
  }

  error(message: any, trace?: string, context?: string) {
    this.logger.error({ context, trace, correlationId: getCorrelationId() }, message);
  }

  warn(message: any, context?: string) {
    this.logger.warn({ context, correlationId: getCorrelationId() }, message);
  }

  debug(message: any, context?: string) {
    this.logger.debug({ context, correlationId: getCorrelationId() }, message);
  }

  verbose(message: any, context?: string) {
    this.logger.trace({ context, correlationId: getCorrelationId() }, message);
  }
}
