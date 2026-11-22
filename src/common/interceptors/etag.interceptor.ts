import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  HttpStatus,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { createHash } from 'crypto';
import type { Request, Response } from 'express';
import { ETAG_KEY } from '../decorators/use-etag.decorator';

/**
 * Global interceptor that provides ETag / If-None-Match support for GET
 * endpoints that are decorated with `@UseETag()`.
 *
 * Behaviour:
 *  - Only activates for GET requests on handlers that carry the `@UseETag()`
 *    decorator, so mutation endpoints (POST, PATCH, PUT, DELETE) are unaffected.
 *  - Computes a **weak ETag** (`W/"<hash>"`) from the SHA-256 of the
 *    JSON-serialised response body (first 8 hex characters is sufficient for
 *    cache validation).
 *  - Sets the `ETag` response header on every matched response.
 *  - Returns `304 Not Modified` (with an empty body) when the client's
 *    `If-None-Match` header value matches the computed ETag, avoiding
 *    unnecessary payload transfer.
 *
 * Registration:
 *  Register globally in `main.ts` via `app.useGlobalInterceptors(new ETagInterceptor(reflector))`,
 *  or provide it in `AppModule` so NestJS can inject the `Reflector`.
 */
@Injectable()
export class ETagInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const useETag = this.reflector.getAllAndOverride<boolean>(ETAG_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!useETag) {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();

    // Only handle GET requests — never short-circuit mutations.
    if (request.method !== 'GET') {
      return next.handle();
    }

    const response = http.getResponse<Response>();

    return next.handle().pipe(
      map((body) => {
        const etag = ETagInterceptor.computeETag(body);

        response.setHeader('ETag', etag);

        const ifNoneMatch = request.headers['if-none-match'];
        if (ifNoneMatch && ETagInterceptor.matches(ifNoneMatch, etag)) {
          response.status(HttpStatus.NOT_MODIFIED).end();
          // Return undefined to signal that the response has been handled.
          return undefined;
        }

        return body;
      }),
    );
  }

  /**
   * Compute a weak ETag for the given value.
   * Uses SHA-256 of the JSON representation, taking the first 16 hex chars
   * as a compact but collision-resistant digest.
   */
  static computeETag(body: unknown): string {
    const json = JSON.stringify(body) ?? '';
    const hash = createHash('sha256').update(json).digest('hex').slice(0, 16);
    return `W/"${hash}"`;
  }

  /**
   * Check whether the client-supplied `If-None-Match` value matches the
   * computed ETag.  Handles both single values and comma-separated lists,
   * and the wildcard `*`.
   */
  static matches(ifNoneMatch: string, etag: string): boolean {
    if (ifNoneMatch.trim() === '*') {
      return true;
    }

    // Strip W/ prefix and quotes for comparison (weak comparison per RFC 7232)
    const normalise = (v: string) =>
      v.trim().replace(/^W\//, '').replace(/^"|"$/g, '');

    const candidates = ifNoneMatch.split(',').map(normalise);
    const target = normalise(etag);
    return candidates.includes(target);
  }
}
