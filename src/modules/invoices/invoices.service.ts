import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource, Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import type { Response } from 'express';
import { Invoice, InvoiceStatus } from './invoice.entity';
import { InvoiceLineItem } from './invoice-line-item.entity';
import { CreateInvoiceDto, UpdateInvoiceDto } from './dto/invoice.dto';
import { ProductsService } from '../products/products.service';
import { EmailNotificationService } from '../notifications/email-notification.service';
import { PaymentsService } from '../payments/payments.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { serializeInvoice } from '../webhooks/payload-serializers/invoice.serializer';
import { generateStandaloneInvoicePdf } from '../payments/export/invoice.generator';

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

@Injectable()
export class InvoicesService {
  constructor(
    @InjectRepository(Invoice)
    private readonly invoiceRepository: Repository<Invoice>,
    private readonly dataSource: DataSource,
    private readonly productsService: ProductsService,
    private readonly emailNotificationService: EmailNotificationService,
    private readonly paymentsService: PaymentsService,
    private readonly configService: ConfigService,
    private readonly webhooksService: WebhooksService,
  ) {}

  async create(merchantId: string, dto: CreateInvoiceDto): Promise<Invoice> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await runner.query('SELECT pg_advisory_xact_lock(hashtext($1))', [merchantId]);
      const result = await runner.query(
        'SELECT COALESCE(MAX("number"), 0) + 1 AS "nextNumber" FROM "invoices" WHERE "merchantId" = $1',
        [merchantId],
      );
      const number = Number(result[0].nextNumber);
      const resolvedItems = await this.resolveLineItems(
        merchantId,
        dto.lineItems,
        dto.currency,
      );
      const totals = this.calculateTotals(resolvedItems, dto.taxRate ?? 0);
      const invoice = runner.manager.create(Invoice, {
        merchantId,
        number,
        customerEmail: dto.customerEmail,
        customerName: dto.customerName ?? null,
        currency: dto.currency,
        ...totals,
        taxRate: (dto.taxRate ?? 0).toFixed(2),
        dueDate: new Date(dto.dueDate),
        status: InvoiceStatus.DRAFT,
        publicToken: randomBytes(32).toString('hex'),
        lineItems: this.toLineItems(resolvedItems),
      });
      const saved = await runner.manager.save(invoice);
      await runner.commitTransaction();
      return saved;
    } catch (error) {
      await runner.rollbackTransaction();
      throw error;
    } finally {
      await runner.release();
    }
  }

  async findAll(merchantId: string): Promise<Invoice[]> {
    return this.invoiceRepository.find({
      where: { merchantId },
      relations: { lineItems: true },
      order: { number: 'DESC' },
    });
  }

  async findOne(merchantId: string, id: string): Promise<Invoice> {
    const invoice = await this.invoiceRepository.findOne({
      where: { id },
      relations: { lineItems: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.merchantId !== merchantId) throw new ForbiddenException();
    return this.updateOverdueStatus(invoice);
  }

  async update(merchantId: string, id: string, dto: UpdateInvoiceDto): Promise<Invoice> {
    const invoice = await this.findOne(merchantId, id);
    this.assertDraft(invoice);
    if (dto.customerEmail !== undefined) invoice.customerEmail = dto.customerEmail;
    if (dto.customerName !== undefined) invoice.customerName = dto.customerName ?? null;
    if (dto.currency !== undefined) invoice.currency = dto.currency;
    if (dto.dueDate !== undefined) invoice.dueDate = new Date(dto.dueDate);
    if (dto.taxRate !== undefined) invoice.taxRate = dto.taxRate.toFixed(2);
    if (dto.lineItems !== undefined) {
      const resolvedItems = await this.resolveLineItems(
        merchantId,
        dto.lineItems,
        invoice.currency,
      );
      Object.assign(invoice, this.calculateTotals(resolvedItems, Number(invoice.taxRate)));
      invoice.lineItems = this.toLineItems(resolvedItems);
    }
    return this.invoiceRepository.save(invoice);
  }

  async remove(merchantId: string, id: string): Promise<Invoice> {
    const invoice = await this.findOne(merchantId, id);
    this.assertDraft(invoice);
    invoice.status = InvoiceStatus.VOID;
    const saved = await this.invoiceRepository.save(invoice);
    await this.dispatchInvoiceEvent('invoice.voided', saved);
    return saved;
  }

  async send(merchantId: string, id: string): Promise<Invoice> {
    const invoice = await this.findOne(merchantId, id);
    this.assertDraft(invoice);
    if (!invoice.customerEmail) throw new BadRequestException('Invoice customer email is required');
    invoice.status = InvoiceStatus.OPEN;
    await this.invoiceRepository.save(invoice);
    const baseUrl = this.configService.get<string>('APP_URL', 'http://localhost:3000');
    await this.emailNotificationService.sendInvoiceCreated(invoice.customerEmail, {
      invoiceNumber: this.formatNumber(invoice.number),
      customerName: invoice.customerName,
      amount: invoice.total,
      currency: invoice.currency,
      dueDate: invoice.dueDate.toISOString(),
      payUrl: `${baseUrl.replace(/\/$/, '')}/v1/public/invoices/${invoice.publicToken}`,
    });
    await this.dispatchInvoiceEvent('invoice.sent', invoice);
    return invoice;
  }

  async void(merchantId: string, id: string): Promise<Invoice> {
    const invoice = await this.findOne(merchantId, id);
    if (![InvoiceStatus.OPEN, InvoiceStatus.OVERDUE].includes(invoice.status)) {
      throw new ConflictException('Only open or overdue invoices can be voided');
    }
    invoice.status = InvoiceStatus.VOID;
    const saved = await this.invoiceRepository.save(invoice);
    await this.dispatchInvoiceEvent('invoice.voided', saved);
    return saved;
  }

  async duplicate(merchantId: string, id: string): Promise<Invoice> {
    const source = await this.findOne(merchantId, id);
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await runner.query('SELECT pg_advisory_xact_lock(hashtext($1))', [merchantId]);
      const result = await runner.query(
        'SELECT COALESCE(MAX("number"), 0) + 1 AS "nextNumber" FROM "invoices" WHERE "merchantId" = $1',
        [merchantId],
      );
      const number = Number(result[0].nextNumber);
      const invoice = runner.manager.create(Invoice, {
        merchantId,
        number,
        customerEmail: source.customerEmail,
        customerName: source.customerName,
        currency: source.currency,
        subtotal: source.subtotal,
        taxRate: source.taxRate,
        taxAmount: source.taxAmount,
        total: source.total,
        dueDate: source.dueDate,
        status: InvoiceStatus.DRAFT,
        publicToken: randomBytes(32).toString('hex'),
        lineItems: source.lineItems.map((item) => ({
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          amount: item.amount,
          productId: item.productId,
        }) as InvoiceLineItem),
      });
      const saved = await runner.manager.save(invoice);
      await runner.commitTransaction();
      return saved;
    } catch (error) {
      await runner.rollbackTransaction();
      throw error;
    } finally {
      await runner.release();
    }
  }

  async findPublic(token: string): Promise<Invoice> {
    const invoice = await this.invoiceRepository.findOne({
      where: { publicToken: token },
      relations: { lineItems: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return this.updateOverdueStatus(invoice);
  }

  async streamPdf(merchantId: string, id: string, response: Response): Promise<void> {
    const invoice = await this.findOne(merchantId, id);
    const invoiceNumber = this.formatNumber(invoice.number);
    const document = generateStandaloneInvoicePdf({ invoice });
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader(
      'Content-Disposition',
      `inline; filename="${invoiceNumber}.pdf"`,
    );
    document.pipe(response);
  }

  async pay(token: string, payerEmail?: string): Promise<unknown> {
    const invoice = await this.findPublic(token);
    if (![InvoiceStatus.OPEN, InvoiceStatus.OVERDUE].includes(invoice.status)) {
      throw new ConflictException('Invoice is not payable');
    }
    return this.paymentsService.createForInvoice(invoice, payerEmail);
  }

  async markPaid(invoiceId: string, paymentId: string): Promise<void> {
    const invoice = await this.invoiceRepository.findOne({
      where: { id: invoiceId },
      relations: { lineItems: true },
    });
    if (!invoice) return;
    if (![InvoiceStatus.OPEN, InvoiceStatus.OVERDUE].includes(invoice.status)) return;

    const result = await this.invoiceRepository
      .createQueryBuilder()
      .update(Invoice)
      .set({ status: InvoiceStatus.PAID, paymentId })
      .where('id = :invoiceId', { invoiceId })
      .andWhere('status IN (:...statuses)', {
        statuses: [InvoiceStatus.OPEN, InvoiceStatus.OVERDUE],
      })
      .execute();

    if (result.affected && result.affected > 0) {
      invoice.status = InvoiceStatus.PAID;
      invoice.paymentId = paymentId;
      await this.dispatchInvoiceEvent('invoice.paid', invoice);
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async markOverdueInvoices(): Promise<void> {
    const overdueInvoices = await this.invoiceRepository.find({
      where: { status: InvoiceStatus.OPEN },
      relations: { lineItems: true },
    });
    const toMarkOverdue = overdueInvoices.filter(
      (invoice) => invoice.dueDate < new Date(),
    );
    if (toMarkOverdue.length === 0) return;

    await this.invoiceRepository
      .createQueryBuilder()
      .update(Invoice)
      .set({ status: InvoiceStatus.OVERDUE })
      .where('status = :status', { status: InvoiceStatus.OPEN })
      .andWhere('"dueDate" < :now', { now: new Date() })
      .execute();

    for (const invoice of toMarkOverdue) {
      invoice.status = InvoiceStatus.OVERDUE;
      await this.dispatchInvoiceEvent('invoice.overdue', invoice);
    }
  }

  private async resolveLineItems(
    merchantId: string,
    items: CreateInvoiceDto['lineItems'],
    currency: string,
  ): Promise<Array<{ description: string; quantity: number; unitPrice: number; productId?: string }>> {
    return Promise.all(
      items.map(async (item) => {
        const hasProductId = typeof item.productId === 'string' && item.productId.trim().length > 0;

        if (hasProductId) {
          const product = await this.productsService.validateAndGetProduct(
            merchantId,
            item.productId!,
            currency,
          );
          return {
            description: item.description ?? product.name,
            quantity: item.quantity,
            unitPrice: item.unitPrice ?? Number(product.unitAmount),
            productId: item.productId,
          };
        }

        if (!item.description || item.unitPrice === undefined) {
          throw new BadRequestException(
            'Line items must provide productId or both description and unitPrice',
          );
        }

        return {
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        };
      }),
    );
  }

  private async updateOverdueStatus(invoice: Invoice): Promise<Invoice> {
    if (invoice.status === InvoiceStatus.OPEN && invoice.dueDate < new Date()) {
      invoice.status = InvoiceStatus.OVERDUE;
      const saved = await this.invoiceRepository.save(invoice);
      await this.dispatchInvoiceEvent('invoice.overdue', saved);
      return saved;
    }
    return invoice;
  }

  private assertDraft(invoice: Invoice): void {
    if (invoice.status !== InvoiceStatus.DRAFT) {
      throw new ConflictException('Only draft invoices can be edited');
    }
  }

  private async dispatchInvoiceEvent(event: string, invoice: Invoice): Promise<void> {
    try {
      const payload = serializeInvoice(invoice);
      await this.webhooksService.dispatchEventToMerchant(invoice.merchantId, event, payload);
    } catch {
      // Webhook delivery failures must not break the invoice state transition.
    }
  }

  private calculateTotals(
    items: Array<{ quantity: number; unitPrice: number }>,
    taxRate: number,
  ): Pick<Invoice, 'subtotal' | 'taxAmount' | 'total'> {
    const subtotal = money(
      items.reduce((sum, item) => sum + money(item.quantity * item.unitPrice), 0),
    );
    const taxAmount = money((subtotal * taxRate) / 100);
    return {
      subtotal: subtotal.toFixed(2),
      taxAmount: taxAmount.toFixed(2),
      total: money(subtotal + taxAmount).toFixed(2),
    };
  }

  private toLineItems(
    items: Array<{ description: string; quantity: number; unitPrice: number; productId?: string }>,
  ): InvoiceLineItem[] {
    return items.map((item) => ({
      description: item.description,
      quantity: item.quantity.toFixed(3),
      unitPrice: item.unitPrice.toFixed(2),
      amount: money(item.quantity * item.unitPrice).toFixed(2),
      productId: item.productId ?? null,
    }) as InvoiceLineItem);
  }

  private formatNumber(number: number): string {
    return `INV-${String(number).padStart(6, '0')}`;
  }
}
