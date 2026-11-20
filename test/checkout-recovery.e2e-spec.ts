import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import {
  CheckoutSession,
  CheckoutSessionStatus,
} from '../src/modules/checkout-sessions/entities/checkout-session.entity';
import { CheckoutSessionsService } from '../src/modules/checkout-sessions/checkout-sessions.service';
import { CheckoutRecoveryService } from '../src/modules/checkout-sessions/checkout-recovery.service';
import { CheckoutSessionsPublicController } from '../src/modules/checkout-sessions/checkout-sessions.controller';
import { MerchantsService } from '../src/modules/merchants/merchants.service';
import { WebhooksService } from '../src/modules/webhooks/webhooks.service';
import { PaymentsService } from '../src/modules/payments/payments.service';
import { ProductsService } from '../src/modules/products/products.service';
import { CouponsService } from '../src/modules/coupons/coupons.service';
import { NotificationPreferencesService } from '../src/modules/notifications/notification-preferences.service';
import { EmailNotificationService } from '../src/modules/notifications/email-notification.service';
import { EmailSuppression } from '../src/modules/notifications/email-suppression.entity';
import { ConfigService } from '@nestjs/config';
import { AppLogger } from '../src/modules/logger/logger.service';
import { AnalyticsController } from '../src/modules/analytics/analytics.controller';
import { AnalyticsService } from '../src/modules/analytics/analytics.service';

class InMemoryCheckoutSessionRepository {
  sessions: CheckoutSession[] = [];

  create(data: Partial<CheckoutSession>): CheckoutSession {
    return {
      id: randomUUID(),
      publicId: 'generated-public-id',
      merchantId: '',
      lineItems: [],
      currency: 'USD',
      total: 0,
      subtotal: 0,
      discountAmount: 0,
      couponId: null,
      couponCode: null,
      customerId: null,
      customerEmail: null,
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
      expiresAt: new Date(),
      status: CheckoutSessionStatus.OPEN,
      paymentId: null,
      recoveryEmailSentAt: null,
      recoveredFromId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...data,
    } as CheckoutSession;
  }

  async save(session: CheckoutSession): Promise<CheckoutSession> {
    const index = this.sessions.findIndex((item) => item.id === session.id);
    if (index >= 0) {
      this.sessions[index] = session;
    } else {
      this.sessions.push(session);
    }
    return session;
  }

  async findOne(options: {
    where: { publicId?: string; id?: string };
  }): Promise<CheckoutSession | null> {
    return (
      this.sessions.find(
        (item) =>
          (!options.where.publicId ||
            item.publicId === options.where.publicId) &&
          (!options.where.id || item.id === options.where.id),
      ) ?? null
    );
  }

  async find(): Promise<CheckoutSession[]> {
    return this.sessions;
  }

  async update(
    criteria: { id: string },
    partial: Partial<CheckoutSession>,
  ): Promise<{ affected: number }> {
    const session = this.sessions.find((item) => item.id === criteria.id);
    if (!session) return { affected: 0 };
    Object.assign(session, partial);
    return { affected: 1 };
  }
}

describe('Abandoned checkout recovery (e2e)', () => {
  let app: INestApplication<App>;
  let sessionRepo: InMemoryCheckoutSessionRepository;
  let analyticsService: any;

  beforeAll(async () => {
    sessionRepo = new InMemoryCheckoutSessionRepository();
    analyticsService = {
      getCheckoutRecoveryAnalytics: jest.fn().mockResolvedValue({
        from: '2026-11-01T00:00:00.000Z',
        to: '2026-11-20T00:00:00.000Z',
        expiredSessionsWithEmail: 1,
        recoveryEmailsSent: 1,
        recoveredSessions: 1,
        recoveryRate: 1,
      }),
    };

    await sessionRepo.save(
      sessionRepo.create({
        publicId: 'expiredPublicId1234567890',
        merchantId: 'merchant-1',
        customerEmail: 'buyer@example.com',
        status: CheckoutSessionStatus.EXPIRED,
        expiresAt: new Date('2026-11-20T10:00:00.000Z'),
        lineItems: [{ name: 'Widget', quantity: 2, unitAmount: 1500 }],
        subtotal: 3000,
        total: 3000,
      }),
    );

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [CheckoutSessionsPublicController, AnalyticsController],
      providers: [
        CheckoutSessionsService,
        CheckoutRecoveryService,
        { provide: getRepositoryToken(CheckoutSession), useValue: sessionRepo },
        {
          provide: getRepositoryToken(EmailSuppression),
          useValue: { count: jest.fn().mockResolvedValue(0) },
        },
        {
          provide: MerchantsService,
          useValue: {
            getSettings: jest.fn().mockResolvedValue({
              recoveryEmailsEnabled: true,
              recoveryEmailDelayMinutes: 60,
            }),
            getProfile: jest
              .fn()
              .mockResolvedValue({ businessName: 'Acme Store' }),
          },
        },
        {
          provide: NotificationPreferencesService,
          useValue: { isEmailEnabled: jest.fn().mockResolvedValue(true) },
        },
        {
          provide: EmailNotificationService,
          useValue: { sendCheckoutRecoveryEmail: jest.fn() },
        },
        {
          provide: WebhooksService,
          useValue: { dispatchEventToMerchant: jest.fn() },
        },
        { provide: PaymentsService, useValue: { create: jest.fn() } },
        {
          provide: ProductsService,
          useValue: { validateAndGetProduct: jest.fn() },
        },
        {
          provide: CouponsService,
          useValue: { validateForCheckoutSession: jest.fn() },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn((_k, def) => def) },
        },
        {
          provide: AppLogger,
          useValue: {
            child: jest
              .fn()
              .mockReturnValue({ info: jest.fn(), error: jest.fn() }),
          },
        },
        { provide: AnalyticsService, useValue: analyticsService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp: () => { getRequest: () => any };
        }) => {
          context.switchToHttp().getRequest().user = { id: 'merchant-1' };
          return true;
        },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a fresh checkout session from a recovery link', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/checkout/sessions/expiredPublicId1234567890/recover')
      .expect(201);

    expect(response.body).toMatchObject({
      merchantId: 'merchant-1',
      customerEmail: 'buyer@example.com',
      currency: 'USD',
      total: 3000,
      status: CheckoutSessionStatus.OPEN,
      recoveredFromId: sessionRepo.sessions[0].id,
      lineItems: [{ name: 'Widget', quantity: 2, unitAmount: 1500 }],
    });
    expect(response.body.publicId).not.toBe('expiredPublicId1234567890');
    expect(sessionRepo.sessions).toHaveLength(2);
  });

  it('returns 404 for an unknown recovery link', async () => {
    await request(app.getHttpServer())
      .post('/v1/checkout/sessions/unknown/recover')
      .expect(404);
  });

  it('exposes checkout recovery analytics', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/analytics/checkout-recovery')
      .expect(200);

    expect(response.body).toMatchObject({
      expiredSessionsWithEmail: 1,
      recoveryEmailsSent: 1,
      recoveredSessions: 1,
      recoveryRate: 1,
    });
    expect(analyticsService.getCheckoutRecoveryAnalytics).toHaveBeenCalledWith(
      'merchant-1',
      expect.any(Object),
    );
  });
});
