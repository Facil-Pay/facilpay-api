import { Injectable, BadRequestException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CorsConfig } from './cors-config.interface';
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

@Injectable()
export class CorsConfigService {
  private readonly config: CorsConfig;

  constructor() {
    this.config = this.loadConfig();
  }

  private loadConfig(): CorsConfig {
    // Support both CORS_ALLOWED_ORIGINS (new) and ALLOWED_ORIGINS (legacy)
    const rawOrigins = process.env.CORS_ALLOWED_ORIGINS ?? process.env.ALLOWED_ORIGINS ?? '';
    const allowedOrigins = rawOrigins.split(',').map((o) => o.trim()).filter(Boolean);
    const credentials = process.env.CORS_ALLOW_CREDENTIALS === 'true';

    const configData = {
      allowedOrigins,
      credentials,
      allowedMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Correlation-Id'],
    };

    return plainToInstance(CorsConfig, configData);
  }

  async validate(): Promise<string[]> {
    const config = plainToInstance(CorsConfig, this.config);
    const errors = await validate(config);

    if (errors.length > 0) {
      const errorMessages = errors
        .flatMap((e) => Object.values(e.constraints || {}))
        .join(', ');
      throw new BadRequestException(`CORS configuration validation failed: ${errorMessages}`);
    }

    return [];
  }

  getAllowedOrigins(): string[] {
    return this.config.allowedOrigins;
  }

  getCredentials(): boolean {
    return this.config.credentials;
  }

  getAllowedMethods(): string[] {
    return this.config.allowedMethods || ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'];
  }

  getAllowedHeaders(): string[] {
    return this.config.allowedHeaders || ['Content-Type', 'Authorization'];
  }

  getCorsOptions(): CorsOptions {
    const allowedOrigins = this.getAllowedOrigins();
    const credentials = this.getCredentials();

    return {
      // Strict allowlist: only listed origins pass; unlisted get no ACAO header
      origin: (origin, callback) => {
        // Allow server-to-server requests (no Origin header)
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        callback(null, false);
      },
      credentials,
      methods: this.getAllowedMethods(),
      allowedHeaders: this.getAllowedHeaders(),
      exposedHeaders: ['X-Correlation-Id'],
    };
  }
}
