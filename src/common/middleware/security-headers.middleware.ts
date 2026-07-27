import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

/**
 * Applies security-related HTTP response headers equivalent to helmet defaults,
 * without requiring the helmet dependency.
 */
@Injectable()
export class SecurityHeadersMiddleware implements NestMiddleware {
  use(_req: Request, res: Response, next: NextFunction) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '0'); // Disabled per modern guidance; rely on CSP
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; base-uri 'self'; font-src 'self' https: data:; " +
        "form-action 'self'; frame-ancestors 'self'; img-src 'self' data:; " +
        "object-src 'none'; script-src 'self'; script-src-attr 'none'; " +
        "style-src 'self' https: 'unsafe-inline'; upgrade-insecure-requests",
    );
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=15552000; includeSubDomains',
    );
    res.removeHeader('X-Powered-By');
    next();
  }
}
