import { Injectable, BadRequestException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CorsConfig } from './cors-config.interface';

@Injectable()
export class CorsConfigService {
  private readonly config: CorsConfig;

  constructor() {
    this.config = this.loadConfig();
  }

  private loadConfig(): CorsConfig {
    const raw = process.env.CORS_ALLOWED_ORIGINS ?? process.env.ALLOWED_ORIGINS ?? '';
    const allowedOrigins = raw.split(',').map((s) => s.trim()).filter(Boolean);
    const credentials = process.env.CORS_CREDENTIALS === 'true';

    const configData = {
      allowedOrigins,
      credentials,
      allowedMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    };

    const config = plainToInstance(CorsConfig, configData);
    return config;
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

  getCorsOptions(): object {
    const allowedOrigins = this.getAllowedOrigins();
    return {
      origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
        if (!origin) {
          cb(null, true);
          return;
        }
        if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
          cb(null, true);
        } else {
          cb(null, false);
        }
      },
      credentials: this.getCredentials(),
      methods: this.getAllowedMethods(),
      allowedHeaders: this.getAllowedHeaders(),
    };
  }
}
