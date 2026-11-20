jest.mock('../src/tracing', () => ({
  getTraceId: jest.fn(),
  initializeTracing: jest.fn(),
}));

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { SettlementsController } from '../src/modules/settlements/settlements.controller';
import { SettlementsService } from '../src/modules/settlements/settlements.service';

/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */

describe('Settlement preferred-asset endpoints (e2e)', () => {
  let app: INestApplication<App>;

  const settlementService = {
    upsertConfig: jest.fn(),
    getSettlementStatement: jest.fn(),
  };

  const statement = {
    merchant: 'merchant-1',
    period: {
      from: new Date('2026-11-01T00:00:00Z'),
      to: new Date('2026-11-20T00:00:00Z'),
    },
    settlement: {
      id: 'settlement-1',
      currency: 'USD',
      totalAmount: 142.5,
      transactionHash: null,
    },
    rows: [
      {
        paymentId: 'payment-1',
        reference: 'INV-1',
        gross: 100,
        fee: 5,
        net: 95,
        refunds: 0,
        adjustments: 0,
      },
    ],
    totals: {
      paymentId: 'TOTAL',
      reference: null,
      gross: 100,
      fee: 5,
      net: 95,
      refunds: 0,
      adjustments: 0,
    },
    conversion: {
      settlementAsset:
        'USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
      sourceAsset: 'XLM',
      sourceAmount: 95,
      destAmount: 94.4,
      conversionRate: 0.99368421,
      slippagePercent: 0.10582,
      conversionFee: 0.00001,
      conversionTransactionHash: 'CONVERSION_HASH',
    },
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [SettlementsController],
      providers: [{ provide: SettlementsService, useValue: settlementService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp: () => { getRequest: () => any };
        }) => {
          const requestContext = context.switchToHttp().getRequest();
          requestContext.user = {
            id: requestContext.headers['x-merchant-id'],
            roles: [],
          };
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
    jest.clearAllMocks();
    settlementService.upsertConfig.mockResolvedValue({
      id: 'config-1',
      userId: 'merchant-1',
      schedule: 'weekly',
      currency: 'USD',
      settlementAsset: statement.conversion.settlementAsset,
      maxSlippagePercent: 0.5,
    });
    settlementService.getSettlementStatement.mockResolvedValue(statement);
  });

  afterAll(async () => {
    await app.close();
  });

  it('accepts a preferred settlement asset and slippage limit in the config endpoint', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/settlements/config')
      .set('x-merchant-id', 'merchant-1')
      .send({
        schedule: 'weekly',
        currency: 'USD',
        settlementAsset: statement.conversion.settlementAsset,
        maxSlippagePercent: 0.5,
      })
      .expect(200);

    expect(settlementService.upsertConfig).toHaveBeenCalledWith('merchant-1', {
      schedule: 'weekly',
      currency: 'USD',
      settlementAsset: statement.conversion.settlementAsset,
      maxSlippagePercent: 0.5,
    });
    expect(response.body.settlementAsset).toBe(
      statement.conversion.settlementAsset,
    );
  });

  it('rejects an invalid preferred settlement asset', async () => {
    await request(app.getHttpServer())
      .post('/v1/settlements/config')
      .set('x-merchant-id', 'merchant-1')
      .send({
        schedule: 'weekly',
        currency: 'USD',
        settlementAsset: 'NOT-AN-ASSET',
      })
      .expect(400);

    expect(settlementService.upsertConfig).not.toHaveBeenCalled();
  });

  it('includes conversion details in the CSV statement', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/settlements/settlement-1/statement?format=csv')
      .set('x-merchant-id', 'merchant-1')
      .expect(200);

    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.text).toContain('settlementAsset,USDC:');
    expect(response.text).toContain('sourceAsset,XLM');
    expect(response.text).toContain('conversionRate,0.99368421');
    expect(response.text).toContain('slippagePercent,0.10582');
    expect(response.text).toContain(
      'conversionTransactionHash,CONVERSION_HASH',
    );
  });

  it('includes conversion details in the PDF statement', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/settlements/settlement-1/statement?format=pdf')
      .set('x-merchant-id', 'merchant-1')
      .expect(200);

    expect(response.headers['content-type']).toContain('application/pdf');
    expect(response.body.length).toBeGreaterThan(100);
  });
});
