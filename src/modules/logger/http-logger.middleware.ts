import { Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { Request, Response, NextFunction } from 'express';
import { AppLogger } from './logger.service';
import {
  extractUserId,
  getRequestId,
  normalizeErrorContext,
  sanitizeBody,
  sanitizeHeaders,
} from './logging.utils';
import { Logger } from 'pino';

const DEFAULT_BODY_MAX_LENGTH = 2048;

@Injectable()
export class HttpLoggerMiddleware implements NestMiddleware {
  private readonly logger: Logger;
  private readonly logBody: boolean;
  private readonly logResponseBody: boolean;
  private readonly bodyMaxLength: number;

  constructor(appLogger: AppLogger, configService: ConfigService) {
    this.logger = appLogger.child({ module: HttpLoggerMiddleware.name });
    this.logBody = parseBoolean(configService.get<string>('LOG_BODY'), false);
    this.logResponseBody = parseBoolean(
      configService.get<string>('LOG_RESPONSE_BODY'),
      false,
    );
    this.bodyMaxLength = parseNumber(
      configService.get<string>('LOG_BODY_MAX_LENGTH'),
      DEFAULT_BODY_MAX_LENGTH,
    );
  }

  use(req: Request, res: Response, next: NextFunction) {
    const requestId = getRequestId(req.headers) ?? randomUUID();
    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);

    const startTime = process.hrtime.bigint();
    let responseBody: unknown;

    if (this.logResponseBody) {
      const originalJson = res.json.bind(res);
      const originalSend = res.send.bind(res);

      res.json = (body: unknown) => {
        responseBody = body;
        return originalJson(body);
      };

      res.send = (body: unknown) => {
        responseBody = body;
        return originalSend(body);
      };
    }

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startTime) / 1e6;
      const statusCode = res.statusCode;
      const path = req.originalUrl ?? req.url;
      const userId = extractUserId(req.user);

      const meta: Record<string, unknown> = {
        requestId,
        method: req.method,
        path,
        statusCode,
        durationMs: Number(durationMs.toFixed(2)),
        userId,
      };

      const requestMeta: Record<string, unknown> = {};
      const sanitizedHeaders = sanitizeHeaders(req.headers);
      if (sanitizedHeaders) {
        requestMeta.headers = sanitizedHeaders;
      }

      if (this.logBody) {
        const sanitizedBody = sanitizeBody(req.body, this.bodyMaxLength);
        if (sanitizedBody !== undefined) {
          requestMeta.body = sanitizedBody;
        }
      }

      if (Object.keys(requestMeta).length > 0) {
        meta.request = requestMeta;
      }

      const responseMeta: Record<string, unknown> = {};
      const contentLength = getContentLength(res);
      if (contentLength !== undefined) {
        responseMeta.contentLength = contentLength;
      }

      if (this.logResponseBody) {
        const sanitizedResponseBody = sanitizeBody(
          responseBody,
          this.bodyMaxLength,
        );
        if (sanitizedResponseBody !== undefined) {
          responseMeta.body = sanitizedResponseBody;
        }
      }

      if (Object.keys(responseMeta).length > 0) {
        meta.response = responseMeta;
      }

      if (statusCode >= 400) {
        meta.error = normalizeErrorContext(res.locals?.error);
      }

      const message = `${req.method} ${path} ${statusCode} ${durationMs.toFixed(1)}ms`;

      if (statusCode >= 500) {
        this.logger.error(meta, message);
      } else if (statusCode >= 400) {
        this.logger.warn(meta, message);
      } else {
        this.logger.info(meta, message);
      }
    });

    next();
  }
}

function getContentLength(res: Response): number | undefined {
  const value = res.getHeader('content-length');

  if (Array.isArray(value)) {
    const parsed = Number(value[0]);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
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
