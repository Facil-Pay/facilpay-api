import { ConflictException } from '@nestjs/common';
import { Invoice, InvoiceStatus } from './invoice.entity';
import { InvoicesService } from './invoices.service';
import { generateStandaloneInvoicePdf } from '../payments/export/invoice.generator';

describe('InvoicesService', () => {
  let service: InvoicesService;
  let repository: any;
  let paymentsService: any;
  let webhooksService: any;
  let emailNotificationService: any;
  let configService: any;

  const makeInvoice = (overrides: Partial<Invoice> = {}) => ({
    id: 'invoice-id',
    number: 1,
    merchantId: 'merchant-id',
    customerEmail: 'buyer@example.com',
    customerName: 'Buyer',
    currency: 'USD',
    subtotal: '100.00',
    taxRate: '10.00',
    taxAmount: '10.00',
    total: '110.00',
    dueDate: new Date('2030-01-01T00:00:00.000Z'),
    status: InvoiceStatus.DRAFT,
    paymentId: null,
    publicToken: 'public-token',
    lineItems: [],
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  }) as Invoice;

  beforeEach(() => {
    repository = {
      findOne: jest.fn(),
      find: jest.fn(),
      save: jest.fn(async (invoice) => invoice),
      createQueryBuilder: jest.fn(),
    };
    paymentsService = { createForInvoice: jest.fn() };
    emailNotificationService = { sendInvoiceCreated: jest.fn().mockResolvedValue(undefined) };
    configService = { get: jest.fn().mockReturnValue('http://localhost:3000') };
    webhooksService = { dispatchEventToMerchant: jest.fn().mockResolvedValue(undefined) };
    service = new InvoicesService(
      repository,
      {} as any, // dataSource
      {} as any, // productsService
      emailNotificationService,
      paymentsService,
      configService,
      webhooksService,
    );
  });

  it('rejects editing invoices that have left DRAFT', async () => {
    repository.findOne.mockResolvedValue(makeInvoice({ status: InvoiceStatus.OPEN }));

    await expect(service.update('merchant-id', 'invoice-id', { customerName: 'Changed' }))
      .rejects.toThrow(ConflictException);
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('allocates sequential invoice numbers under a merchant transaction lock', async () => {
    const savedInvoices: any[] = [];
    const queryRunner = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      query: jest.fn((sql: string) =>
        sql.includes('COALESCE(MAX')
          ? Promise.resolve([{ nextNumber: savedInvoices.length + 7 }])
          : Promise.resolve([]),
      ),
      manager: {
        create: jest.fn((_entity, data) => data),
        save: jest.fn(async (invoice) => {
          savedInvoices.push(invoice);
          return { id: `invoice-${invoice.number}`, ...invoice };
        }),
      },
    };
    (service as any).dataSource = {
      createQueryRunner: jest.fn().mockReturnValue(queryRunner),
    };
    const dto = {
      customerEmail: 'buyer@example.com',
      currency: 'USD',
      dueDate: '2030-01-01T00:00:00.000Z',
      taxRate: 10,
      lineItems: [{ description: 'Service', quantity: 2, unitPrice: 50 }],
    };

    await service.create('merchant-id', dto);
    await service.create('merchant-id', dto);

    expect(savedInvoices.map((invoice) => invoice.number)).toEqual([7, 8]);
    expect(queryRunner.query).toHaveBeenNthCalledWith(
      1,
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      ['merchant-id'],
    );
    expect(queryRunner.commitTransaction).toHaveBeenCalledTimes(2);
  });

  it('rejects voiding a paid invoice', async () => {
    repository.findOne.mockResolvedValue(makeInvoice({ status: InvoiceStatus.PAID }));

    await expect(service.void('merchant-id', 'invoice-id')).rejects.toThrow(ConflictException);
  });

  it('creates a payment from the server-calculated invoice amount', async () => {
    const invoice = makeInvoice({ status: InvoiceStatus.OPEN });
    repository.findOne.mockResolvedValue(invoice);
    paymentsService.createForInvoice.mockResolvedValue({ id: 'payment-id' });

    await expect(service.pay('public-token')).resolves.toEqual({ id: 'payment-id' });
    expect(paymentsService.createForInvoice).toHaveBeenCalledWith(invoice, undefined);
  });

  it('marks an open invoice paid with the completing payment ID', async () => {
    const invoice = makeInvoice({ status: InvoiceStatus.OPEN, lineItems: [] });
    repository.findOne.mockResolvedValue(invoice);
    const builder: any = {};
    builder.update = jest.fn().mockReturnValue(builder);
    builder.set = jest.fn().mockReturnValue(builder);
    builder.where = jest.fn().mockReturnValue(builder);
    builder.andWhere = jest.fn().mockReturnValue(builder);
    builder.execute = jest.fn().mockResolvedValue({ affected: 1 });
    repository.createQueryBuilder.mockReturnValue(builder);

    await service.markPaid('invoice-id', 'payment-id');

    expect(builder.set).toHaveBeenCalledWith({
      status: InvoiceStatus.PAID,
      paymentId: 'payment-id',
    });
    expect(builder.andWhere).toHaveBeenCalledWith('status IN (:...statuses)', {
      statuses: [InvoiceStatus.OPEN, InvoiceStatus.OVERDUE],
    });
  });

  it('renders a standalone invoice PDF with line items', async () => {
    const document = generateStandaloneInvoicePdf({
      invoice: {
        number: 17,
        status: InvoiceStatus.OPEN,
        customerName: 'Buyer',
        customerEmail: 'buyer@example.com',
        currency: 'USD',
        subtotal: '100.00',
        taxRate: '10.00',
        taxAmount: '10.00',
        total: '110.00',
        dueDate: new Date('2026-12-31T00:00:00.000Z'),
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        lineItems: [{ description: 'Consulting', quantity: '2', unitPrice: '50.00', amount: '100.00' }],
      },
    });
    const chunks: Buffer[] = [];
    document.on('data', (chunk: Buffer) => chunks.push(chunk));
    const finished = new Promise<void>((resolve, reject) => {
      document.on('end', resolve);
      document.on('error', reject);
    });
    await finished;
    const pdf = Buffer.concat(chunks);
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.length).toBeGreaterThan(500);
  });

  // ── Webhook dispatch tests ──────────────────────────────────────────────

  describe('webhook dispatch', () => {
    it('dispatches invoice.sent when an invoice is sent', async () => {
      const invoice = makeInvoice({ status: InvoiceStatus.DRAFT, customerEmail: 'buyer@example.com' });
      repository.findOne.mockResolvedValue(invoice);

      await service.send('merchant-id', 'invoice-id');

      expect(invoice.status).toBe(InvoiceStatus.OPEN);
      expect(webhooksService.dispatchEventToMerchant).toHaveBeenCalledWith(
        'merchant-id',
        'invoice.sent',
        expect.objectContaining({
          invoiceId: 'invoice-id',
          status: InvoiceStatus.OPEN,
          customerEmail: 'buyer@example.com',
        }),
      );
    });

    it('dispatches invoice.voided when an open invoice is voided', async () => {
      const invoice = makeInvoice({ status: InvoiceStatus.OPEN });
      repository.findOne.mockResolvedValue(invoice);

      await service.void('merchant-id', 'invoice-id');

      expect(invoice.status).toBe(InvoiceStatus.VOID);
      expect(webhooksService.dispatchEventToMerchant).toHaveBeenCalledWith(
        'merchant-id',
        'invoice.voided',
        expect.objectContaining({
          invoiceId: 'invoice-id',
          status: InvoiceStatus.VOID,
        }),
      );
    });

    it('dispatches invoice.voided when a draft invoice is deleted', async () => {
      const invoice = makeInvoice({ status: InvoiceStatus.DRAFT });
      repository.findOne.mockResolvedValue(invoice);

      await service.remove('merchant-id', 'invoice-id');

      expect(invoice.status).toBe(InvoiceStatus.VOID);
      expect(webhooksService.dispatchEventToMerchant).toHaveBeenCalledWith(
        'merchant-id',
        'invoice.voided',
        expect.objectContaining({
          invoiceId: 'invoice-id',
          status: InvoiceStatus.VOID,
        }),
      );
    });

    it('dispatches invoice.overdue when a fetched invoice is past due', async () => {
      const invoice = makeInvoice({
        status: InvoiceStatus.OPEN,
        dueDate: new Date('2020-01-01T00:00:00.000Z'),
      });
      repository.findOne.mockResolvedValue(invoice);

      await service.findOne('merchant-id', 'invoice-id');

      expect(webhooksService.dispatchEventToMerchant).toHaveBeenCalledWith(
        'merchant-id',
        'invoice.overdue',
        expect.objectContaining({
          invoiceId: 'invoice-id',
          status: InvoiceStatus.OVERDUE,
        }),
      );
    });

    it('dispatches invoice.overdue for each invoice marked by the cron job', async () => {
      const overdue = makeInvoice({ id: 'inv-1', status: InvoiceStatus.OPEN, dueDate: new Date('2020-01-01') });
      const notOverdue = makeInvoice({ id: 'inv-2', status: InvoiceStatus.OPEN, dueDate: new Date('2030-01-01') });
      repository.find.mockResolvedValue([overdue, notOverdue]);
      const builder: any = {};
      builder.update = jest.fn().mockReturnValue(builder);
      builder.set = jest.fn().mockReturnValue(builder);
      builder.where = jest.fn().mockReturnValue(builder);
      builder.andWhere = jest.fn().mockReturnValue(builder);
      builder.execute = jest.fn().mockResolvedValue({ affected: 1 });
      repository.createQueryBuilder.mockReturnValue(builder);

      await service.markOverdueInvoices();

      expect(webhooksService.dispatchEventToMerchant).toHaveBeenCalledTimes(1);
      expect(webhooksService.dispatchEventToMerchant).toHaveBeenCalledWith(
        'merchant-id',
        'invoice.overdue',
        expect.objectContaining({ invoiceId: 'inv-1' }),
      );
    });

    it('dispatches invoice.paid when markPaid transitions an open invoice', async () => {
      const invoice = makeInvoice({ status: InvoiceStatus.OPEN, lineItems: [] });
      repository.findOne.mockResolvedValue(invoice);
      const builder: any = {};
      builder.update = jest.fn().mockReturnValue(builder);
      builder.set = jest.fn().mockReturnValue(builder);
      builder.where = jest.fn().mockReturnValue(builder);
      builder.andWhere = jest.fn().mockReturnValue(builder);
      builder.execute = jest.fn().mockResolvedValue({ affected: 1 });
      repository.createQueryBuilder.mockReturnValue(builder);

      await service.markPaid('invoice-id', 'payment-id');

      expect(webhooksService.dispatchEventToMerchant).toHaveBeenCalledWith(
        'merchant-id',
        'invoice.paid',
        expect.objectContaining({
          invoiceId: 'invoice-id',
          status: InvoiceStatus.PAID,
          paymentId: 'payment-id',
        }),
      );
    });

    it('does not dispatch invoice.paid when the invoice is already paid', async () => {
      const invoice = makeInvoice({ status: InvoiceStatus.PAID, lineItems: [] });
      repository.findOne.mockResolvedValue(invoice);
      const builder: any = {};
      builder.update = jest.fn().mockReturnValue(builder);
      builder.set = jest.fn().mockReturnValue(builder);
      builder.where = jest.fn().mockReturnValue(builder);
      builder.andWhere = jest.fn().mockReturnValue(builder);
      builder.execute = jest.fn().mockResolvedValue({ affected: 0 });
      repository.createQueryBuilder.mockReturnValue(builder);

      await service.markPaid('invoice-id', 'payment-id');

      expect(webhooksService.dispatchEventToMerchant).not.toHaveBeenCalled();
    });

    it('does not dispatch when no invoices are overdue in the cron job', async () => {
      repository.find.mockResolvedValue([]);
      const builder: any = {};
      builder.update = jest.fn().mockReturnValue(builder);
      builder.set = jest.fn().mockReturnValue(builder);
      builder.where = jest.fn().mockReturnValue(builder);
      builder.andWhere = jest.fn().mockReturnValue(builder);
      builder.execute = jest.fn().mockResolvedValue({ affected: 0 });
      repository.createQueryBuilder.mockReturnValue(builder);

      await service.markOverdueInvoices();

      expect(webhooksService.dispatchEventToMerchant).not.toHaveBeenCalled();
    });

    it('does not dispatch invoice.overdue when the invoice is still within the due date', async () => {
      const invoice = makeInvoice({
        status: InvoiceStatus.OPEN,
        dueDate: new Date('2030-01-01T00:00:00.000Z'),
      });
      repository.findOne.mockResolvedValue(invoice);

      await service.findOne('merchant-id', 'invoice-id');

      expect(webhooksService.dispatchEventToMerchant).not.toHaveBeenCalled();
    });
  });

  // ── Payload serializer tests ─────────────────────────────────────────────

  describe('invoice payload serializer', () => {
    it('includes line items and formatted invoice number in the payload', async () => {
      const invoice = makeInvoice({
        number: 42,
        status: InvoiceStatus.OPEN,
        lineItems: [
          { description: 'Consulting', quantity: '2', unitPrice: '50.00', amount: '100.00', productId: null } as any,
        ],
        paymentId: 'pay-123',
      });
      repository.findOne.mockResolvedValue(invoice);

      await service.send('merchant-id', 'invoice-id');

      const payload = webhooksService.dispatchEventToMerchant.mock.calls[0][2];
      expect(payload.number).toBe('INV-000042');
      expect(payload.lineItems).toHaveLength(1);
      expect(payload.lineItems[0]).toEqual({
        description: 'Consulting',
        quantity: '2',
        unitPrice: '50.00',
        amount: '100.00',
        productId: null,
      });
      expect(payload.paymentId).toBe('pay-123');
    });
  });
});
