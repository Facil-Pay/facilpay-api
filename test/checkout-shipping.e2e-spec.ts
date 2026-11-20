import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  CheckoutSessionsController,
  CheckoutSessionsPublicController,
} from '../src/modules/checkout-sessions/checkout-sessions.controller';
import { CheckoutSessionsService } from '../src/modules/checkout-sessions/checkout-sessions.service';
import { CheckoutSession } from '../src/modules/checkout-sessions/entities/checkout-session.entity';
import { Customer } from '../src/modules/customers/customer.entity';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { MerchantsService } from '../src/modules/merchants/merchants.service';
import { WebhooksService } from '../src/modules/webhooks/webhooks.service';
import { PaymentsService } from '../src/modules/payments/payments.service';
import { ProductsService } from '../src/modules/products/products.service';
import { CouponsService } from '../src/modules/coupons/coupons.service';
import { AppLogger } from '../src/modules/logger/logger.service';

/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/require-await */

class InMemorySessionRepository {
  sessions: CheckoutSession[] = [];

  create(data: Partial<CheckoutSession>): CheckoutSession {
    return data as CheckoutSession;
  }

  async save(session: CheckoutSession): Promise<CheckoutSession> {
    const index = this.sessions.findIndex((entry) => entry.id === session.id);
    if (index === -1) {
      this.sessions.push(session);
    } else {
      this.sessions[index] = session;
    }
    return session;
  }

  async findOne(options: {
    where: { publicId?: string; id?: string };
  }): Promise<CheckoutSession | null> {
    return (
      this.sessions.find((session) =>
        options.where.publicId
          ? session.publicId === options.where.publicId
          : session.id === options.where.id,
      ) ?? null
    );
  }
}

describe('Checkout shipping address (e2e)', () => {
  let app: INestApplication<App>;
  let repository: InMemorySessionRepository;

  beforeAll(async () => {
    repository = new InMemorySessionRepository();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [
        CheckoutSessionsController,
        CheckoutSessionsPublicController,
      ],
      providers: [
        CheckoutSessionsService,
        { provide: getRepositoryToken(CheckoutSession), useValue: repository },
        {
          provide: getRepositoryToken(Customer),
          useValue: { findOne: jest.fn(), create: jest.fn(), save: jest.fn() },
        },
        {
          provide: MerchantsService,
          useValue: {
            getBrandingWithDefaults: jest.fn().mockResolvedValue({
              displayName: 'My Store',
              logo: null,
              primaryColor: '#000000',
            }),
          },
        },
        {
          provide: WebhooksService,
          useValue: {
            dispatchEventToMerchant: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: PaymentsService,
          useValue: {
            create: jest.fn().mockResolvedValue({ id: 'payment-1' }),
          },
        },
        { provide: ProductsService, useValue: {} },
        {
          provide: ConfigService,
          useValue: { get: (_key: string, fallback: string) => fallback },
        },
        {
          provide: AppLogger,
          useValue: {
            child: () => ({
              info: jest.fn(),
              error: jest.fn(),
              warn: jest.fn(),
            }),
          },
        },
        {
          provide: CouponsService,
          useValue: {
            validateForCheckoutSession: jest.fn(),
            redeem: jest.fn(),
            releaseRedemption: jest.fn(),
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp: () => { getRequest: () => any };
        }) => {
          const req = context.switchToHttp().getRequest();
          req.user = { id: req.headers['x-merchant-id'] };
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
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
  });

  beforeEach(() => {
    repository.sessions = [];
  });

  afterAll(async () => {
    await app.close();
  });

  const createSession = () =>
    request(app.getHttpServer())
      .post('/v1/checkout/sessions')
      .set('x-merchant-id', 'merchant-1')
      .send({
        lineItems: [{ name: 'Shoes', quantity: 1, unitAmount: 5000 }],
        currency: 'USD',
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
        shippingAddressCollection: { allowedCountries: ['US', 'CA'] },
        shippingOptions: [
          { id: 'standard', label: 'Standard shipping', amount: 500 },
        ],
      });

  it('creates a session with shipping configuration and a preselected total', async () => {
    const response = await createSession().expect(201);

    expect(response.body).toMatchObject({
      total: 5000,
      shippingAmount: 0,
      shippingOptions: [
        { id: 'standard', label: 'Standard shipping', amount: 500 },
      ],
      shippingAddressCollection: { allowedCountries: ['US', 'CA'] },
      shippingAddress: null,
    });
  });

  it('rejects an address whose country is outside the allowlist', async () => {
    const created = await createSession().expect(201);

    await request(app.getHttpServer())
      .post(`/v1/checkout/sessions/${created.body.publicId}/shipping-address`)
      .send({
        shippingAddress: {
          line1: '10 Rue A',
          city: 'Paris',
          postalCode: '75001',
          country: 'FR',
        },
        shippingOptionId: 'standard',
      })
      .expect(400);
  });

  it('collects the address, reports shipping separately and updates the total', async () => {
    const created = await createSession().expect(201);
    const publicId = created.body.publicId as string;

    const submitted = await request(app.getHttpServer())
      .post(`/v1/checkout/sessions/${publicId}/shipping-address`)
      .send({
        shippingAddress: {
          name: 'Jane Doe',
          line1: '123 Main St',
          city: 'New York',
          state: 'NY',
          postalCode: '10001',
          country: 'US',
        },
        shippingOptionId: 'standard',
      })
      .expect(200);

    expect(submitted.body).toMatchObject({
      subtotalFormatted: 'USD 50.00',
      shippingFormatted: 'USD 5.00',
      totalFormatted: 'USD 55.00',
      shippingOptionId: 'standard',
      shippingAddress: { country: 'US', city: 'New York' },
    });

    const publicPage = await request(app.getHttpServer())
      .get(`/v1/checkout/sessions/${publicId}/public`)
      .expect(200);

    expect(publicPage.body).toMatchObject({
      shippingFormatted: 'USD 5.00',
      totalFormatted: 'USD 55.00',
      shippingAddressCollection: { allowedCountries: ['US', 'CA'] },
      shippingOptions: [{ id: 'standard', amount: 500 }],
      shippingAddress: { country: 'US' },
    });
  });

  it('rejects an invalid ISO country code at the DTO boundary', async () => {
    const created = await createSession().expect(201);

    await request(app.getHttpServer())
      .post(`/v1/checkout/sessions/${created.body.publicId}/shipping-address`)
      .send({
        shippingAddress: {
          line1: '123 Main St',
          city: 'New York',
          postalCode: '10001',
          country: 'USA',
        },
        shippingOptionId: 'standard',
      })
      .expect(400);
  });
});
