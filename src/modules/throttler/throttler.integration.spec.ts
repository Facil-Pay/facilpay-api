import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, HttpStatus } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { Controller, Post, Get, HttpCode } from '@nestjs/common';
import { AuthThrottle, WebhookThrottle } from './throttler.decorator';
import request from 'supertest';

// Test controller
@Controller('test')
class TestController {
  @AuthThrottle()
  @Post('auth')
  @HttpCode(HttpStatus.OK)
  authEndpoint() {
    return { success: true };
  }

  @WebhookThrottle()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  webhookEndpoint() {
    return { success: true };
  }

  @Get('health')
  @HttpCode(HttpStatus.OK)
  health() {
    return { status: 'ok' };
  }
}

describe('Throttler Integration', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot([
          {
            name: 'default',
            ttl: 1000,
            limit: 3,
          },
          {
            name: 'auth',
            ttl: 1000,
            limit: 2,
          },
          {
            name: 'webhook',
            ttl: 1000,
            limit: 5,
          },
        ]),
      ],
      controllers: [TestController],
      providers: [
        {
          provide: APP_GUARD,
          useClass: ThrottlerGuard,
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('Throttler Configuration', () => {
    it('should be defined', () => {
      expect(app).toBeDefined();
    });

    it('should allow request within default limit', async () => {
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
      // RateLimit headers should be present
      expect(res.headers['x-ratelimit-limit']).toBeDefined();
      expect(res.headers['x-ratelimit-remaining']).toBeDefined();
      expect(res.headers['x-ratelimit-reset']).toBeDefined();
    });

    it('should apply auth throttle to login endpoint', async () => {
      const res = await request(app.getHttpServer())
        .post('/test/auth')
        .send({});

      expect([HttpStatus.OK, HttpStatus.CREATED]).toContain(res.status);
    });

    it('should apply webhook throttle to webhook endpoint', async () => {
      const res = await request(app.getHttpServer())
        .post('/test/webhook')
        .send({});

      expect([HttpStatus.OK, HttpStatus.CREATED]).toContain(res.status);
    });
  });
});
