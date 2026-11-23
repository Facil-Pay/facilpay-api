import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { RequestLogsService } from './request-logs.service';
import { ApiKey } from '../api-keys/api-key.entity';
@Injectable()
export class RequestLogsMiddleware implements NestMiddleware {
  constructor(private readonly logs: RequestLogsService) {}
  use(req: Request & { apiKey?: ApiKey }, res: Response, next: NextFunction): void {
    const start = performance.now();
    let responseBody: unknown = null;
    const originalJson = res.json;
    res.json = function(body: unknown) { responseBody = body; return originalJson.call(this, body); };
    res.once('finish', () => {
      if (!req.apiKey) return;
      // Route templates exclude query strings and path parameters, which can contain secrets.
      const route = typeof req.route?.path === 'string' ? req.baseUrl + req.route.path : '[unmatched]';
      const idempotency = req.get('idempotency-key');
      this.logs.enqueue({ merchantId: req.apiKey.userId, apiKeyId: req.apiKey.id,
        method: req.method.slice(0, 16), path: route.slice(0, 2048), status: res.statusCode,
        latencyMs: Math.max(0, Math.round(performance.now() - start)),
        idempotencyKey: idempotency?.slice(0, 255) ?? null,
        requestBody: req.body, responseBody,
      });
    });
    next();
  }
}
