jest.mock('../src/tracing', () => ({
  getTraceId: jest.fn(),
  initializeTracing: jest.fn(),
  runWithTrace: (_name: string, fn: () => unknown) => fn(),
}));
jest.mock('../src/modules/payments/payments.service', () => ({
  PaymentsService: class PaymentsService {},
}));

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { Invoice, InvoiceStatus } from '../src/modules/invoices/invoice.entity';
import { InvoicesController } from '../src/modules/invoices/invoices.controller';
import { InvoicesService } from '../src/modules/invoices/invoices.service';
import { PublicInvoicesController } from '../src/modules/invoices/public-invoices.controller';
import { EmailNotificationService } from '../src/modules/notifications/email-notification.service';
import { PaymentsService } from '../src/modules/payments/payments.service';
import { ProductsService } from '../src/modules/products/products.service';
import { WebhooksService } from '../src/modules/webhooks/webhooks.service';

/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */

class InMemoryInvoiceRepository {
  invoices: Invoice[] = [];

  create(data: Partial<Invoice>): Invoice {
    return {
      id: randomUUID(),
      merchantId: '',
      number: 1,
      customerEmail: '',
      customerName: null,
      currency: 'USD',
      subtotal: '0.00',
      taxRate: '0.00',
      taxAmount: '0.00',
      total: '0.00',
      dueDate: new Date(),
      status: InvoiceStatus.DRAFT,
      paymentId: null,
      publicToken: '',
      lineItems: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      ...data,
    } as Invoice;
  }

  save(invoice: Invoice): Promise<Invoice> {
    if (!invoice.id) invoice.id = randomUUID();
    invoice.updatedAt = new Date();
    invoice.lineItems = (invoice.lineItems ?? []).map((item) => ({
      ...item,
      id: item.id ?? randomUUID(),
      invoiceId: invoice.id,
    }));
    const idx = this.invoices.findIndex((existing) => existing.id === invoice.id);
    if (idx >= 0) {
      this.invoices[idx] = invoice;
    } else {
      this.invoices.push(invoice);
    }
    return Promise.resolve(invoice);
  }

  find(options: { where?: { merchantId?: string; status?: InvoiceStatus } }): Promise<Invoice[]> {
    const filtered = this.invoices
      .filter((inv) => {
        if (options.where?.merchantId && inv.merchantId !== options.where.merchantId) {
          return false;
        }
        if (options.where?.status && inv.status !== options.where.status) {
          return false;
        }
        return true;
      })
      .sort((a, b) => b.number - a.number);
    return Promise.resolve(filtered);
  }

  findOne(options: { where?: { id?: string; publicToken?: string } }): Promise<Invoice | null> {
    const found = this.invoices.find((inv) => {
      if (options.where?.id && inv.id !== options.where.id) return false;
      if (options.where?.publicToken && inv.publicToken !== options.where.publicToken) {
        return false;
      }
      return true;
    });
    return Promise.resolve(found ?? null);
  }

  createQueryBuilder() {
    let targetId = '';
    let updateValues: Partial<Invoice> = {};
    let allowedStatuses: InvoiceStatus[] = [];
    const builder = {
      update: () => builder,
      set: (values: Partial<Invoice>) => {
        updateValues = values;
        return builder;
      },
      where: (_sql: string, params?: { invoiceId?: string }) => {
        if (params?.invoiceId) targetId = params.invoiceId;
        return builder;
      },
      andWhere: (_sql: string, params?: { statuses?: InvoiceStatus[] }) => {
        if (params?.statuses) allowedStatuses = params.statuses;
        return builder;
      },
      execute: () => {
        const inv = this.invoices.find((i) => i.id === targetId);
        if (inv && (allowedStatuses.length === 0 || allowedStatuses.includes(inv.status))) {
          Object.assign(inv, updateValues);
          return Promise.resolve({ affected: 1 });
        }
        return Promise.resolve({ affected: 0 });
      },
    };
    return builder;
  }
}

describe('Invoices & Public Invoice Payment Flow (e2e)', () => {
  let app: INestApplication<App>;
  let repository: InMemoryInvoiceRepository;
  let invoicesService: InvoicesService;
  let emailNotificationService: { sendInvoiceCreated: jest.Mock };
  let paymentsService: { createForInvoice: jest.Mock };
  let webhooksService: { dispatchEventToMerchant: jest.Mock };

  beforeAll(async () => {
    repository = new InMemoryInvoiceRepository();
    emailNotificationService = {
      sendInvoiceCreated: jest.fn().mockResolvedValue(undefined),
    };
    paymentsService = {
      createForInvoice: jest.fn(async (invoice: Invoice, payerEmail?: string) => ({
        id: `pay-${invoice.id}`,
        invoiceId: invoice.id,
        amount: invoice.total,
        currency: invoice.currency,
        payerEmail: payerEmail ?? invoice.customerEmail,
        status: 'PENDING',
      })),
    };
    webhooksService = {
      dispatchEventToMerchant: jest.fn().mockResolvedValue(undefined),
    };

    const dataSource = {
      createQueryRunner: () => ({
        connect: jest.fn().mockResolvedValue(undefined),
        startTransaction: jest.fn().mockResolvedValue(undefined),
        commitTransaction: jest.fn().mockResolvedValue(undefined),
        rollbackTransaction: jest.fn().mockResolvedValue(undefined),
        release: jest.fn().mockResolvedValue(undefined),
        query: jest.fn((sql: string, params: unknown[]) => {
          if (sql.includes('COALESCE(MAX')) {
            const merchantId = String(params[0]);
            const maxNum = repository.invoices
              .filter((inv) => inv.merchantId === merchantId)
              .reduce((max, inv) => Math.max(max, inv.number), 0);
            return Promise.resolve([{ nextNumber: maxNum + 1 }]);
          }
          return Promise.resolve([]);
        }),
        manager: {
          create: (_entity: unknown, data: Partial<Invoice>) => repository.create(data),
          save: (entity: Invoice) => repository.save(entity),
        },
      }),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [InvoicesController, PublicInvoicesController],
      providers: [
        InvoicesService,
        {
          provide: getRepositoryToken(Invoice),
          useValue: repository,
        },
        {
          provide: DataSource,
          useValue: dataSource,
        },
        {
          provide: ProductsService,
          useValue: { validateAndGetProduct: jest.fn() },
        },
        {
          provide: EmailNotificationService,
          useValue: emailNotificationService,
        },
        {
          provide: PaymentsService,
          useValue: paymentsService,
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('http://localhost:3000') },
        },
        {
          provide: WebhooksService,
          useValue: webhooksService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: { switchToHttp: () => { getRequest: () => any } }) => {
          const req = context.switchToHttp().getRequest();
          req.user = { id: req.headers['x-merchant-id'] || 'merchant-1' };
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
    invoicesService = moduleFixture.get<InvoicesService>(InvoicesService);
  });

  beforeEach(() => {
    repository.invoices = [];
    jest.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  it('completes the full create -> send -> public view -> pay -> paid flow', async () => {
    // 1. Create draft invoice
    const createRes = await request(app.getHttpServer())
      .post('/v1/invoices')
      .set('x-merchant-id', 'merchant-1')
      .send({
        customerEmail: 'customer@example.com',
        customerName: 'Acme Corp',
        currency: 'USD',
        dueDate: '2030-12-31T00:00:00.000Z',
        taxRate: 10,
        lineItems: [
          { description: 'API Integration', quantity: 2, unitPrice: 150 },
          { description: 'Monthly Hosting', quantity: 1, unitPrice: 50 },
        ],
      })
      .expect(201);

    expect(createRes.body).toMatchObject({
      merchantId: 'merchant-1',
      number: 1,
      customerEmail: 'customer@example.com',
      customerName: 'Acme Corp',
      currency: 'USD',
      subtotal: '350.00',
      taxRate: '10.00',
      taxAmount: '35.00',
      total: '385.00',
      status: InvoiceStatus.DRAFT,
    });

    const invoiceId: string = createRes.body.id;
    const publicToken: string = createRes.body.publicToken;

    // 2. Send invoice -> transitions DRAFT to OPEN and triggers email + webhook
    const sendRes = await request(app.getHttpServer())
      .post(`/v1/invoices/${invoiceId}/send`)
      .set('x-merchant-id', 'merchant-1')
      .expect(201);

    expect(sendRes.body.status).toBe(InvoiceStatus.OPEN);
    expect(emailNotificationService.sendInvoiceCreated).toHaveBeenCalledWith(
      'customer@example.com',
      expect.objectContaining({
        invoiceNumber: 'INV-000001',
        amount: '385.00',
        currency: 'USD',
      }),
    );

    // 3. Public view via /v1/public/invoices/:token (no auth required, hides internal merchantId)
    const publicViewRes = await request(app.getHttpServer())
      .get(`/v1/public/invoices/${publicToken}`)
      .expect(200);

    expect(publicViewRes.body).toMatchObject({
      number: 1,
      customerName: 'Acme Corp',
      currency: 'USD',
      subtotal: '350.00',
      taxRate: '10.00',
      taxAmount: '35.00',
      total: '385.00',
      status: InvoiceStatus.OPEN,
    });
    expect(publicViewRes.body).not.toHaveProperty('merchantId');
    expect(publicViewRes.body).not.toHaveProperty('publicToken');

    // 4. Pay invoice via /v1/public/invoices/:token/pay
    const payRes = await request(app.getHttpServer())
      .post(`/v1/public/invoices/${publicToken}/pay`)
      .send({ payerEmail: 'payer@acme.com' })
      .expect(201);

    expect(payRes.body).toMatchObject({
      id: `pay-${invoiceId}`,
      invoiceId,
      amount: '385.00',
      currency: 'USD',
      payerEmail: 'payer@acme.com',
    });

    // 5. Settlement marks invoice PAID -> subsequent pay attempt returns 409 Conflict
    await invoicesService.markPaid(invoiceId, payRes.body.id);

    const paidInvoiceRes = await request(app.getHttpServer())
      .get(`/v1/invoices/${invoiceId}`)
      .set('x-merchant-id', 'merchant-1')
      .expect(200);
    expect(paidInvoiceRes.body.status).toBe(InvoiceStatus.PAID);
    expect(paidInvoiceRes.body.paymentId).toBe(payRes.body.id);

    await request(app.getHttpServer())
      .post(`/v1/public/invoices/${publicToken}/pay`)
      .send({ payerEmail: 'payer@acme.com' })
      .expect(409);
  });

  it('voids an open invoice and streams a valid PDF document', async () => {
    const created = await request(app.getHttpServer())
      .post('/v1/invoices')
      .set('x-merchant-id', 'merchant-1')
      .send({
        customerEmail: 'pdf@example.com',
        customerName: 'PDF Client',
        currency: 'USD',
        dueDate: '2030-06-01T00:00:00.000Z',
        taxRate: 0,
        lineItems: [{ description: 'Audit Service', quantity: 1, unitPrice: 200 }],
      })
      .expect(201);

    const invoiceId: string = created.body.id;

    // Stream PDF
    const pdfRes = await request(app.getHttpServer())
      .get(`/v1/invoices/${invoiceId}/pdf`)
      .set('x-merchant-id', 'merchant-1')
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);

    expect(pdfRes.headers['content-type']).toContain('application/pdf');
    expect(pdfRes.headers['content-disposition']).toContain('INV-000001.pdf');
    expect((pdfRes.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');

    // Send then void
    await request(app.getHttpServer())
      .post(`/v1/invoices/${invoiceId}/send`)
      .set('x-merchant-id', 'merchant-1')
      .expect(201);

    const voidRes = await request(app.getHttpServer())
      .post(`/v1/invoices/${invoiceId}/void`)
      .set('x-merchant-id', 'merchant-1')
      .expect(201);

    expect(voidRes.body.status).toBe(InvoiceStatus.VOID);

    // Voided invoice cannot be paid publicly
    await request(app.getHttpServer())
      .post(`/v1/public/invoices/${created.body.publicToken}/pay`)
      .send({})
      .expect(409);
  });

  it('returns 404 on cross-merchant access to another merchant invoice', async () => {
    const created = await request(app.getHttpServer())
      .post('/v1/invoices')
      .set('x-merchant-id', 'merchant-1')
      .send({
        customerEmail: 'isolated@example.com',
        currency: 'USD',
        dueDate: '2030-06-01T00:00:00.000Z',
        lineItems: [{ description: 'Item', quantity: 1, unitPrice: 75 }],
      })
      .expect(201);

    const invoiceId: string = created.body.id;

    // Merchant 2 cannot read, update, send, void, stream PDF, or delete Merchant 1's invoice
    await request(app.getHttpServer())
      .get(`/v1/invoices/${invoiceId}`)
      .set('x-merchant-id', 'merchant-2')
      .expect(404);

    await request(app.getHttpServer())
      .patch(`/v1/invoices/${invoiceId}`)
      .set('x-merchant-id', 'merchant-2')
      .send({ customerName: 'Tampered' })
      .expect(404);

    await request(app.getHttpServer())
      .post(`/v1/invoices/${invoiceId}/send`)
      .set('x-merchant-id', 'merchant-2')
      .expect(404);

    await request(app.getHttpServer())
      .post(`/v1/invoices/${invoiceId}/void`)
      .set('x-merchant-id', 'merchant-2')
      .expect(404);

    await request(app.getHttpServer())
      .get(`/v1/invoices/${invoiceId}/pdf`)
      .set('x-merchant-id', 'merchant-2')
      .expect(404);

    await request(app.getHttpServer())
      .delete(`/v1/invoices/${invoiceId}`)
      .set('x-merchant-id', 'merchant-2')
      .expect(404);
  });
});
