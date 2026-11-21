/**
 * E2E tests for per-payment Stellar muxed (M-address) deposit addresses (#647).
 *
 * Covers:
 *  - POST /v1/payments stamps depositAddress + muxedId when the merchant flag is on
 *  - GET /v1/payments/:id returns the generated deposit address
 *  - The address is a valid M-address resolving to the merchant base account
 *  - Merchants without the flag keep the legacy behaviour (no deposit address)
 */
// The real logger pulls in src/tracing.ts, which needs OpenTelemetry packages
// that are not installed everywhere; this suite does not need it.
jest.mock('../src/modules/logger/logger.service', () => ({
  AppLogger: class AppLogger {},
}));

import {
  Body,
  Controller,
  Get,
  INestApplication,
  Param,
  Post,
  ValidationPipe,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import * as StellarSdk from '@stellar/stellar-sdk';
import { PaymentsService } from '../src/modules/payments/payments.service';
import { CreatePaymentDto } from '../src/modules/payments/dto/create-payment.dto';
import { Payment } from '../src/modules/payments/payment.entity';
import { Refund } from '../src/modules/payments/refund.entity';
import { PaymentSplit } from '../src/modules/payments/payment-split.entity';
import { MerchantFeeConfig } from '../src/modules/payments/merchant-fee-config.entity';
import { Dispute } from '../src/modules/payments/dispute.entity';
import { SettlementAdjustment } from '../src/modules/settlements/entities/settlement-adjustment.entity';
import { MerchantSettings } from '../src/modules/merchants/entities/merchant-settings.entity';
import { AppLogger } from '../src/modules/logger/logger.service';
import { PaymentSseService } from '../src/modules/payments/payment-sse.service';
import { EmailNotificationService } from '../src/modules/notifications/email-notification.service';
import { WebhooksService } from '../src/modules/webhooks/webhooks.service';
import { ConfigService } from '@nestjs/config';
import { StellarService } from '../src/modules/stellar/stellar.service';
import { UsersService } from '../src/modules/users/users.service';
import { PaymentLinksService } from '../src/modules/payment-links/payment-links.service';
import { EventsService } from '../src/modules/events/events.service';
import { AuditLogsService } from '../src/modules/audit-logs/audit-logs.service';
import { MerchantsService } from '../src/modules/merchants/merchants.service';
import { InvoiceService } from '../src/modules/payments/invoice.service';

/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */

/**
 * Minimal HTTP surface over the real PaymentsService.
 *
 * The production PaymentsController transitively imports the payments export
 * worker, which depends on modules that are missing on main. Keeping this
 * controller local lets the muxed-address endpoints be exercised over HTTP
 * without pulling in that unrelated, currently-broken graph.
 */
@Controller('v1/payments')
class PaymentsTestController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  create(@Body() dto: CreatePaymentDto) {
    return this.paymentsService.create(dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.paymentsService.findOne(id);
  }
}

const BASE_ACCOUNT = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';
const ENABLED_MERCHANT = 'merchant-muxed';
const DISABLED_MERCHANT = 'merchant-legacy';

const logger = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
};

describe('Muxed account deposit addresses (e2e)', () => {
  let app: INestApplication<App>;
  const payments: Payment[] = [];

  const settingsRepository = {
    findOneBy: jest.fn(async ({ merchantId }: { merchantId: string }) =>
      merchantId === ENABLED_MERCHANT
        ? ({ merchantId, muxedAccountsEnabled: true } as MerchantSettings)
        : null,
    ),
  };

  const paymentRepository = {
    manager: { getRepository: jest.fn() },
    findOneBy: jest.fn(
      async ({ id }: { id: string }) =>
        payments.find((payment) => payment.id === id) ?? null,
    ),
  };

  const manager = {
    findOne: jest.fn(async () => null),
    findOneBy: jest.fn(async () => null),
    getRepository: jest.fn(() => settingsRepository),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) =>
      Object.assign(new Payment(), data),
    ),
    save: jest.fn(async (value: any) => {
      const records = Array.isArray(value) ? value : [value];
      for (const record of records) {
        if (!record.id) record.id = randomUUID();
        const index = payments.findIndex((payment) => payment.id === record.id);
        if (index >= 0) payments[index] = record;
        else payments.push(record);
      }
      return value;
    }),
  };

  const dataSource = {
    createQueryRunner: jest.fn(() => ({
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      manager,
    })),
  };

  const configService = {
    get: jest.fn((key: string, defaultValue?: unknown) => {
      if (key === 'STELLAR_MERCHANT_ACCOUNT_ID') return BASE_ACCOUNT;
      return defaultValue;
    }),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [PaymentsTestController],
      providers: [
        PaymentsService,
        { provide: getRepositoryToken(Payment), useValue: paymentRepository },
        {
          provide: getRepositoryToken(Refund),
          useValue: { find: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: getRepositoryToken(PaymentSplit),
          useValue: { find: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: getRepositoryToken(MerchantFeeConfig),
          useValue: { findOneBy: jest.fn().mockResolvedValue(null) },
        },
        {
          provide: getRepositoryToken(Dispute),
          useValue: { find: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: getRepositoryToken(SettlementAdjustment),
          useValue: {},
        },
        {
          provide: getRepositoryToken(MerchantSettings),
          useValue: settingsRepository,
        },
        { provide: DataSource, useValue: dataSource },
        {
          provide: AppLogger,
          useValue: { child: jest.fn(() => logger) },
        },
        { provide: PaymentSseService, useValue: { emit: jest.fn() } },
        { provide: EmailNotificationService, useValue: {} },
        {
          provide: WebhooksService,
          useValue: { dispatchEventToMerchant: jest.fn() },
        },
        { provide: ConfigService, useValue: configService },
        { provide: StellarService, useValue: {} },
        {
          provide: UsersService,
          useValue: {
            findOne: jest.fn(async (id: string) => ({ id })),
            assertMerchantActive: jest.fn(),
          },
        },
        {
          provide: PaymentLinksService,
          useValue: { getResolvedSuccessUrl: jest.fn() },
        },
        { provide: EventsService, useValue: {} },
        { provide: AuditLogsService, useValue: {} },
        {
          provide: MerchantsService,
          useValue: { enforceGeoRestriction: jest.fn() },
        },
        { provide: InvoiceService, useValue: {} },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
        transformOptions: { enableImplicitConversion: true },
        exceptionFactory: (errors) => {
          const messages = errors.flatMap((error) =>
            error.constraints ? Object.values(error.constraints) : [],
          );
          return new UnprocessableEntityException(
            messages.length ? messages : 'Validation failed',
          );
        },
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns a muxed deposit address for an enabled merchant', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/payments')
      .send({
        amount: 50,
        currency: 'USD',
        description: 'Muxed deposit',
        merchantId: ENABLED_MERCHANT,
      })
      .expect(201);

    expect(response.body.depositAddress).toMatch(/^M/);
    expect(response.body.muxedId).toMatch(/^\d+$/);

    const muxed = StellarSdk.MuxedAccount.fromAddress(
      response.body.depositAddress,
      '0',
    );
    expect(muxed.baseAccount().accountId()).toBe(BASE_ACCOUNT);
    expect(muxed.id()).toBe(response.body.muxedId);
  });

  it('exposes the deposit address on the payment detail endpoint', async () => {
    const created = await request(app.getHttpServer())
      .post('/v1/payments')
      .send({
        amount: 12.5,
        currency: 'USD',
        merchantId: ENABLED_MERCHANT,
      })
      .expect(201);

    const response = await request(app.getHttpServer())
      .get(`/v1/payments/${created.body.id}`)
      .expect(200);

    expect(response.body.depositAddress).toBe(created.body.depositAddress);
    expect(response.body.muxedId).toBe(created.body.muxedId);
  });

  it('does not generate a deposit address for merchants without the flag', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/payments')
      .send({
        amount: 5,
        currency: 'USD',
        merchantId: DISABLED_MERCHANT,
      })
      .expect(201);

    expect(response.body.depositAddress).toBeNull();
    expect(response.body.muxedId).toBeNull();
  });
});
