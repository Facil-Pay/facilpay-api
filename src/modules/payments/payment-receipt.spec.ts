jest.mock('../../tracing', () => ({
  initializeTracing: jest.fn(),
  getTraceId: jest.fn(),
  runWithTrace: (_name: string, fn: () => unknown) => fn(),
}));
jest.mock('../invoices/invoice.entity', () => ({
  Invoice: class {},
  InvoiceStatus: {
    DRAFT: 'draft',
    OPEN: 'open',
    PAID: 'paid',
    VOID: 'void',
    UNCOLLECTIBLE: 'uncollectible',
  },
}));
jest.mock('./export/payments-exporter', () => ({
  createPaymentsPdfDocument: jest.fn(),
  paymentToCsvRow: jest.fn(),
  writePaymentsPdfTable: jest.fn(),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { Payment, PaymentStatus } from './payment.entity';
import { Refund } from './refund.entity';
import { MerchantFeeConfig } from './merchant-fee-config.entity';
import { PaymentSplit } from './payment-split.entity';
import { Dispute } from './dispute.entity';
import { SettlementAdjustment } from '../settlements/entities/settlement-adjustment.entity';
import { MerchantSettings } from '../merchants/entities/merchant-settings.entity';
import { AppLogger } from '../logger/logger.service';
import { PaymentSseService } from './payment-sse.service';
import { EmailNotificationService } from '../notifications/email-notification.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { StellarService } from '../stellar/stellar.service';
import { UsersService } from '../users/users.service';
import { PaymentLinksService } from '../payment-links/payment-links.service';
import { EventsService } from '../events/events.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { InvoiceService } from './invoice.service';
import { MerchantsService } from '../merchants/merchants.service';

const makeMockPayment = (overrides: Partial<Payment> = {}): Payment =>
  ({
    id: 'payment-uuid-1',
    merchantId: 'merchant-uuid-1',
    merchantEmail: 'merchant@example.com',
    payerEmail: 'payer@example.com',
    payerLocale: 'en',
    amount: 99.5,
    currency: 'USDC',
    description: 'Order #42',
    status: PaymentStatus.COMPLETED,
    ...overrides,
  } as Payment);

describe('POST /v1/payments/:id/receipt — resendReceipt', () => {
  let service: PaymentsService;
  let controller: PaymentsController;
  let paymentRepo: { findOneBy: jest.Mock };
  let emailNotificationService: {
    sendPaymentReceipt: jest.Mock;
    sendPayerPaymentConfirmed: jest.Mock;
  };
  let configService: { get: jest.Mock };

  beforeEach(async () => {
    paymentRepo = {
      findOneBy: jest.fn(),
    };
    emailNotificationService = {
      sendPaymentReceipt: jest.fn().mockResolvedValue(undefined),
      sendPayerPaymentConfirmed: jest.fn().mockResolvedValue(undefined),
    };
    configService = {
      get: jest.fn().mockImplementation((_key: string, defaultValue?: string) => defaultValue),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: getRepositoryToken(Payment), useValue: paymentRepo },
        { provide: getRepositoryToken(Refund), useValue: {} },
        { provide: getRepositoryToken(MerchantFeeConfig), useValue: {} },
        { provide: getRepositoryToken(PaymentSplit), useValue: {} },
        { provide: getRepositoryToken(Dispute), useValue: {} },
        { provide: getRepositoryToken(SettlementAdjustment), useValue: {} },
        { provide: getRepositoryToken(MerchantSettings), useValue: {} },
        { provide: DataSource, useValue: {} },
        {
          provide: AppLogger,
          useValue: {
            child: () => ({
              info: jest.fn(),
              error: jest.fn(),
              warn: jest.fn(),
              debug: jest.fn(),
            }),
          },
        },
        { provide: PaymentSseService, useValue: { emit: jest.fn() } },
        { provide: EmailNotificationService, useValue: emailNotificationService },
        { provide: WebhooksService, useValue: {} },
        { provide: ConfigService, useValue: configService },
        { provide: StellarService, useValue: {} },
        { provide: UsersService, useValue: {} },
        { provide: PaymentLinksService, useValue: {} },
        { provide: EventsService, useValue: {} },
        { provide: AuditLogsService, useValue: {} },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
    controller = new PaymentsController(
      service,
      undefined as any,
      undefined as any,
      configService as any,
    );
  });

  it('queues receipt email to payment payerEmail when no override is provided', async () => {
    paymentRepo.findOneBy.mockResolvedValue(makeMockPayment());

    const result = await controller.resendReceipt(
      'payment-uuid-1',
      {},
      { user: { id: 'merchant-uuid-1' } } as any,
    );

    expect(result).toEqual({
      paymentId: 'payment-uuid-1',
      email: 'payer@example.com',
      queued: true,
    });
    expect(emailNotificationService.sendPaymentReceipt).toHaveBeenCalledWith(
      'payer@example.com',
      'payment-uuid-1',
      '99.5',
      'USDC',
      'Order #42',
      'en',
    );
  });

  it('queues receipt email to the override email when provided', async () => {
    paymentRepo.findOneBy.mockResolvedValue(makeMockPayment());

    const result = await service.resendReceipt(
      'payment-uuid-1',
      { email: 'override@example.com' },
      'merchant-uuid-1',
    );

    expect(result).toEqual({
      paymentId: 'payment-uuid-1',
      email: 'override@example.com',
      queued: true,
    });
    expect(emailNotificationService.sendPaymentReceipt).toHaveBeenCalledWith(
      'override@example.com',
      'payment-uuid-1',
      '99.5',
      'USDC',
      'Order #42',
      'en',
    );
  });

  it('throws NotFoundException when payment does not exist', async () => {
    paymentRepo.findOneBy.mockResolvedValue(null);

    await expect(service.resendReceipt('missing-id', {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('throws ForbiddenException when payment belongs to another merchant', async () => {
    paymentRepo.findOneBy.mockResolvedValue(
      makeMockPayment({ merchantId: 'other-merchant' }),
    );

    await expect(
      service.resendReceipt('payment-uuid-1', {}, 'merchant-uuid-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each([
    PaymentStatus.PENDING,
    PaymentStatus.FAILED,
    PaymentStatus.CANCELLED,
    PaymentStatus.EXPIRED,
  ])('throws ConflictException when payment is in %s status (not COMPLETED)', async (status) => {
    paymentRepo.findOneBy.mockResolvedValue(makeMockPayment({ status }));

    await expect(
      service.resendReceipt('payment-uuid-1', {}, 'merchant-uuid-1'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(emailNotificationService.sendPaymentReceipt).not.toHaveBeenCalled();
  });

  it('throws BadRequestException when neither payerEmail nor override email is present', async () => {
    paymentRepo.findOneBy.mockResolvedValue(makeMockPayment({ payerEmail: null }));

    await expect(
      service.resendReceipt('payment-uuid-1', {}, 'merchant-uuid-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('enforces per-payment rate limit and allows other payments independently', async () => {
    paymentRepo.findOneBy.mockImplementation(({ id }: { id: string }) =>
      Promise.resolve(makeMockPayment({ id })),
    );

    await service.resendReceipt('payment-uuid-1', {}, 'merchant-uuid-1');
    await service.resendReceipt('payment-uuid-1', {}, 'merchant-uuid-1');
    await service.resendReceipt('payment-uuid-1', {}, 'merchant-uuid-1');

    await expect(
      service.resendReceipt('payment-uuid-1', {}, 'merchant-uuid-1'),
    ).rejects.toThrow(
      new HttpException(
        'Too many receipt resend requests for this payment. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      ),
    );

    // Another payment ID is not affected by payment-uuid-1's rate limit
    const secondPaymentResult = await service.resendReceipt(
      'payment-uuid-2',
      {},
      'merchant-uuid-1',
    );
    expect(secondPaymentResult.queued).toBe(true);
  });
});
