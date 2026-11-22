import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { ExportsController } from '../src/modules/exports/exports.controller';
import { ExportsService } from '../src/modules/exports/exports.service';

describe('Accounting export endpoints (e2e)', () => {
  let app: INestApplication<App>;
  const exportsService = {
    createExport: jest.fn(),
    getAccountMappings: jest.fn(),
    saveAccountMappings: jest.fn(),
    getExport: jest.fn(),
    buildDownloadUrl: jest.fn(),
    openDownload: jest.fn(),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [ExportsController],
      providers: [{ provide: ExportsService, useValue: exportsService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: {
          switchToHttp: () => { getRequest: () => { headers: Record<string, string>; user?: unknown } };
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
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a merchant-owned QuickBooks CSV export job', async () => {
    exportsService.createExport.mockResolvedValue({
      id: 'export-1',
      status: 'queued',
      type: 'quickbooks_csv',
      format: 'csv',
      createdAt: '2026-01-03T00:00:00.000Z',
    });

    await request(app.getHttpServer())
      .post('/v1/exports')
      .set('x-merchant-id', 'merchant-1')
      .send({ type: 'quickbooks_csv' })
      .expect(202)
      .expect(({ body }) => {
        expect(body).toMatchObject({
          id: 'export-1',
          type: 'quickbooks_csv',
          format: 'csv',
          status: 'queued',
        });
      });

    expect(exportsService.createExport).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'quickbooks_csv',
        format: undefined,
        ownerId: 'merchant-1',
      }),
    );
  });

  it('gets and saves mappings scoped to the authenticated merchant', async () => {
    const mappings = {
      quickbooks: {
        payments: 'Sales',
        fees: 'Fees',
        refunds: 'Refunds',
        payouts: 'Payouts',
        clearing: 'Clearing',
      },
      xero: {
        payments: '4000',
        fees: '6100',
        refunds: '4050',
        payouts: '1010',
        clearing: '1020',
      },
    };
    exportsService.getAccountMappings.mockResolvedValue(mappings);
    exportsService.saveAccountMappings.mockResolvedValue(mappings);

    await request(app.getHttpServer())
      .get('/v1/exports/account-mappings')
      .set('x-merchant-id', 'merchant-1')
      .expect(200)
      .expect(({ body }) => expect(body).toEqual({ mappings }));

    await request(app.getHttpServer())
      .post('/v1/exports/account-mappings')
      .set('x-merchant-id', 'merchant-1')
      .send(mappings)
      .expect(200)
      .expect(({ body }) => expect(body).toEqual({ mappings }));

    expect(exportsService.getAccountMappings).toHaveBeenCalledWith('merchant-1');
    expect(exportsService.saveAccountMappings).toHaveBeenCalledWith(
      'merchant-1',
      mappings,
    );
  });

  it('rejects invalid mappings before saving them', async () => {
    await request(app.getHttpServer())
      .post('/v1/exports/account-mappings')
      .set('x-merchant-id', 'merchant-1')
      .send({
        quickbooks: {
          payments: '',
          fees: 'Fees',
          refunds: 'Refunds',
          payouts: 'Payouts',
          clearing: 'Clearing',
        },
        xero: {
          payments: '4000',
          fees: '6100',
          refunds: '4050',
          payouts: '1010',
          clearing: '1020',
        },
      })
      .expect(400);

    expect(exportsService.saveAccountMappings).not.toHaveBeenCalled();
  });
});
