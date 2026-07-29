import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus } from '@nestjs/common';
import { ThrottlerModule, ThrottlerStorage } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { Controller, Post, Get, HttpCode } from '@nestjs/common';
import { MerchantThrottlerGuard } from './merchant-throttler.guard';
import { UsersService } from '../users/users.service';
import { User } from '../users/user.entity';
import request from 'supertest';

// Mock UsersService
const mockUsersService = {
  findOne: jest.fn(),
};

// Test controller
@Controller('test')
class TestController {
  @Post('auth')
  @HttpCode(HttpStatus.OK)
  authEndpoint() {
    return { success: true };
  }

  @Get('health')
  @HttpCode(HttpStatus.OK)
  health() {
    return { status: 'ok' };
  }
}

describe('MerchantThrottlerGuard', () => {
  let app: INestApplication;
  let mockStorage: Partial<ThrottlerStorage>;

  beforeEach(async () => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create mock storage
    mockStorage = {
      increment: jest.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot([
          {
            name: 'default',
            ttl: 1000,
            limit: 3,
          },
        ]),
      ],
      controllers: [TestController],
      providers: [
        {
          provide: UsersService,
          useValue: mockUsersService,
        },
        {
          provide: APP_GUARD,
          useClass: MerchantThrottlerGuard,
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('Default Rate Limiting', () => {
    it('should allow requests within default limit', async () => {
      const res = await request(app.getHttpServer())
        .get('/test/health')
        .send({});

      expect(res.status).toBe(HttpStatus.OK);
      expect(res.body).toEqual({ status: 'ok' });
    });

    it('should include X-RateLimit headers in response', async () => {
      const res = await request(app.getHttpServer())
        .get('/test/health')
        .send({});

      expect(res.status).toBe(HttpStatus.OK);
      expect(res.headers['x-ratelimit-limit']).toBeDefined();
      expect(res.headers['x-ratelimit-remaining']).toBeDefined();
      expect(res.headers['x-ratelimit-reset']).toBeDefined();
    });
  });

  describe('Custom Merchant Rate Limiting', () => {
    it('should apply custom rate limit when user has custom config enabled', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'merchant@example.com',
        rateLimitEnabled: true,
        rateLimitLimit: 10,
        rateLimitTtl: 2000,
      };

      mockUsersService.findOne.mockResolvedValue(mockUser);

      const res = await request(app.getHttpServer())
        .get('/test/health')
        .set('Authorization', 'Bearer fake-jwt-token')
        .send({});

      expect(res.status).toBe(HttpStatus.OK);
      expect(mockUsersService.findOne).toHaveBeenCalledWith('user-123');
    });

    it('should use default rate limit when user has custom config disabled', async () => {
      const mockUser = {
        id: 'user-123',
        email: 'merchant@example.com',
        rateLimitEnabled: false,
        rateLimitLimit: null,
        rateLimitTtl: null,
      };

      mockUsersService.findOne.mockResolvedValue(mockUser);

      const res = await request(app.getHttpServer())
        .get('/test/health')
        .set('Authorization', 'Bearer fake-jwt-token')
        .send({});

      expect(res.status).toBe(HttpStatus.OK);
      expect(mockUsersService.findOne).toHaveBeenCalledWith('user-123');
    });

    it('should fall back to default rate limit when user service fails', async () => {
      mockUsersService.findOne.mockRejectedValue(new Error('Database error'));

      const res = await request(app.getHttpServer())
        .get('/test/health')
        .set('Authorization', 'Bearer fake-jwt-token')
        .send({});

      expect(res.status).toBe(HttpStatus.OK);
    });

    it('should fall back to default rate limit when user not found', async () => {
      mockUsersService.findOne.mockResolvedValue(null);

      const res = await request(app.getHttpServer())
        .get('/test/health')
        .set('Authorization', 'Bearer fake-jwt-token')
        .send({});

      expect(res.status).toBe(HttpStatus.OK);
    });
  });

  describe('API Key Authentication', () => {
    it('should apply custom rate limit for API key requests', async () => {
      const mockUser = {
        id: 'user-456',
        email: 'apimerchant@example.com',
        rateLimitEnabled: true,
        rateLimitLimit: 50,
        rateLimitTtl: 3000,
      };

      mockUsersService.findOne.mockResolvedValue(mockUser);

      const res = await request(app.getHttpServer())
        .get('/test/health')
        .set('Authorization', 'ApiKey fake-api-key')
        .send({});

      expect(res.status).toBe(HttpStatus.OK);
      expect(mockUsersService.findOne).toHaveBeenCalledWith('user-456');
    });
  });

  describe('Rate Limit Headers', () => {
    it('should return correct rate limit headers with custom limits', async () => {
      const mockUser = {
        id: 'user-789',
        email: 'custom@example.com',
        rateLimitEnabled: true,
        rateLimitLimit: 20,
        rateLimitTtl: 5000,
      };

      mockUsersService.findOne.mockResolvedValue(mockUser);

      const res = await request(app.getHttpServer())
        .get('/test/health')
        .set('Authorization', 'Bearer fake-jwt-token')
        .send({});

      expect(res.status).toBe(HttpStatus.OK);
      expect(res.headers['x-ratelimit-limit']).toBeDefined();
      expect(res.headers['x-ratelimit-remaining']).toBeDefined();
      expect(res.headers['x-ratelimit-reset']).toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle requests without authentication', async () => {
      const res = await request(app.getHttpServer())
        .get('/test/health')
        .send({});

      expect(res.status).toBe(HttpStatus.OK);
      expect(mockUsersService.findOne).not.toHaveBeenCalled();
    });

    it('should handle partial custom rate limit config (only limit)', async () => {
      const mockUser = {
        id: 'user-partial',
        email: 'partial@example.com',
        rateLimitEnabled: true,
        rateLimitLimit: 15,
        rateLimitTtl: null,
      };

      mockUsersService.findOne.mockResolvedValue(mockUser);

      const res = await request(app.getHttpServer())
        .get('/test/health')
        .set('Authorization', 'Bearer fake-jwt-token')
        .send({});

      expect(res.status).toBe(HttpStatus.OK);
    });

    it('should handle partial custom rate limit config (only ttl)', async () => {
      const mockUser = {
        id: 'user-partial-ttl',
        email: 'partial-ttl@example.com',
        rateLimitEnabled: true,
        rateLimitLimit: null,
        rateLimitTtl: 4000,
      };

      mockUsersService.findOne.mockResolvedValue(mockUser);

      const res = await request(app.getHttpServer())
        .get('/test/health')
        .set('Authorization', 'Bearer fake-jwt-token')
        .send({});

      expect(res.status).toBe(HttpStatus.OK);
    });
  });
});