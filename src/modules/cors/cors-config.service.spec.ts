import { CorsConfigService } from './cors-config.service';

describe('CorsConfigService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('getAllowedOrigins', () => {
    it('should return allowed origins from ALLOWED_ORIGINS env var', () => {
      process.env.ALLOWED_ORIGINS = 'http://localhost:3000,https://app.facilpay.com';
      const service = new CorsConfigService();
      expect(service.getAllowedOrigins()).toEqual([
        'http://localhost:3000',
        'https://app.facilpay.com',
      ]);
    });

    it('should return empty array when ALLOWED_ORIGINS is not set', () => {
      delete process.env.ALLOWED_ORIGINS;
      const service = new CorsConfigService();
      expect(service.getAllowedOrigins()).toEqual([]);
    });

    it('should filter out empty strings from origins', () => {
      process.env.ALLOWED_ORIGINS = 'http://localhost:3000,,https://app.facilpay.com';
      const service = new CorsConfigService();
      expect(service.getAllowedOrigins()).toEqual([
        'http://localhost:3000',
        'https://app.facilpay.com',
      ]);
    });
  });

  describe('getCredentials', () => {
    it('should return true when CORS_CREDENTIALS is "true"', () => {
      process.env.CORS_CREDENTIALS = 'true';
      const service = new CorsConfigService();
      expect(service.getCredentials()).toBe(true);
    });

    it('should return false when CORS_CREDENTIALS is not set', () => {
      delete process.env.CORS_CREDENTIALS;
      const service = new CorsConfigService();
      expect(service.getCredentials()).toBe(false);
    });

    it('should return false when CORS_CREDENTIALS is "false"', () => {
      process.env.CORS_CREDENTIALS = 'false';
      const service = new CorsConfigService();
      expect(service.getCredentials()).toBe(false);
    });
  });

  describe('getAllowedMethods', () => {
    it('should return default allowed methods', () => {
      const service = new CorsConfigService();
      expect(service.getAllowedMethods()).toEqual([
        'GET',
        'POST',
        'PUT',
        'DELETE',
        'PATCH',
        'OPTIONS',
      ]);
    });
  });

  describe('getAllowedHeaders', () => {
    it('should return default allowed headers', () => {
      const service = new CorsConfigService();
      expect(service.getAllowedHeaders()).toEqual([
        'Content-Type',
        'Authorization',
      ]);
    });
  });

  describe('getCorsOptions', () => {
    it('should return full CORS options with allowed origins', () => {
      process.env.ALLOWED_ORIGINS = 'http://localhost:3000';
      process.env.CORS_CREDENTIALS = 'true';
      const service = new CorsConfigService();
      expect(service.getCorsOptions()).toEqual({
        origin: ['http://localhost:3000'],
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
      });
    });

    it('should return origin: false when no allowed origins configured', () => {
      delete process.env.ALLOWED_ORIGINS;
      const service = new CorsConfigService();
      const options = service.getCorsOptions() as { origin: boolean };
      expect(options.origin).toBe(false);
    });
  });
});
