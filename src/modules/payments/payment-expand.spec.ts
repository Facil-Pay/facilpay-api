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
import { BadRequestException } from '@nestjs/common';
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
import { Customer } from '../customers/customer.entity';
import { PaymentLink } from '../payment-links/payment-link.entity';
import { PAYMENT_EXPAND_WHITELIST, parseExpandQuery } from '../../common/dto/expand.dto';

const makeMockPayment = (overrides: Partial<Payment> = {}): Payment =>
  ({
    id: 'payment-1',
    merchantId: 'merchant-1',
    customerId: 'customer-1',
    paymentLinkId: 'link-1',
    amount: 100,
    currency: 'USDC',
    status: PaymentStatus.COMPLETED,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Payment);

describe('Payment expand query parameter (?expand=customer,refunds,paymentLink)', () => {
  let service: PaymentsService;
  let controller: PaymentsController;
  let paymentRepo: {
    findOneBy: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let refundRepo: {
    find: jest.Mock;
  };
  let dataSource: {
    manager: { findOneBy: jest.Mock };
  };

  beforeEach(async () => {
    paymentRepo = {
      findOneBy: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    refundRepo = {
      find: jest.fn().mockResolvedValue([{ id: 'refund-1', amount: 25 }]),
    };
    dataSource = {
      manager: {
        findOneBy: jest.fn().mockImplementation((entity, where) => {
          if (entity === Customer) {
            return Promise.resolve({ id: where.id, email: 'customer@example.com' });
          }
          if (entity === PaymentLink) {
            return Promise.resolve({ id: where.id, slug: 'summer-sale' });
          }
          return Promise.resolve(null);
        }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: getRepositoryToken(Payment), useValue: paymentRepo },
        { provide: getRepositoryToken(Refund), useValue: refundRepo },
        { provide: getRepositoryToken(MerchantFeeConfig), useValue: {} },
        { provide: getRepositoryToken(PaymentSplit), useValue: {} },
        { provide: getRepositoryToken(Dispute), useValue: {} },
        { provide: getRepositoryToken(SettlementAdjustment), useValue: {} },
        { provide: getRepositoryToken(MerchantSettings), useValue: {} },
        { provide: DataSource, useValue: dataSource },
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
        { provide: EmailNotificationService, useValue: {} },
        { provide: WebhooksService, useValue: {} },
        { provide: ConfigService, useValue: { get: jest.fn() } },
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
      { get: jest.fn() } as any,
    );
  });

  describe('parseExpandQuery', () => {
    it('returns an empty set when expand is absent', () => {
      expect(parseExpandQuery(undefined, PAYMENT_EXPAND_WHITELIST).size).toBe(0);
      expect(parseExpandQuery('', PAYMENT_EXPAND_WHITELIST).size).toBe(0);
    });

    it('parses comma-separated allowed keys', () => {
      const parsed = parseExpandQuery('customer, refunds, paymentLink', PAYMENT_EXPAND_WHITELIST);
      expect([...parsed]).toEqual(['customer', 'refunds', 'paymentLink']);
    });

    it('throws BadRequestException (400) for unknown expand keys', () => {
      expect(() =>
        parseExpandQuery('customer,secretInternalField', PAYMENT_EXPAND_WHITELIST),
      ).toThrow(BadRequestException);
    });
  });

  describe('findOne', () => {
    it('runs no extra queries when expand is absent', async () => {
      const payment = makeMockPayment();
      paymentRepo.findOneBy.mockResolvedValue(payment);

      const result = await controller.findOne('payment-1');

      expect(result).toBe(payment);
      expect(refundRepo.find).not.toHaveBeenCalled();
      expect(dataSource.manager.findOneBy).not.toHaveBeenCalled();
    });

    it('loads only requested relations when expand=customer,refunds,paymentLink', async () => {
      paymentRepo.findOneBy.mockResolvedValue(makeMockPayment());

      const result = await controller.findOne('payment-1', {
        expand: 'customer,refunds,paymentLink',
      });

      expect(result.customer).toEqual({
        id: 'customer-1',
        email: 'customer@example.com',
      });
      expect(result.refunds).toEqual([{ id: 'refund-1', amount: 25 }]);
      expect(result.paymentLink).toEqual({
        id: 'link-1',
        slug: 'summer-sale',
      });
      expect(refundRepo.find).toHaveBeenCalledTimes(1);
      expect(dataSource.manager.findOneBy).toHaveBeenCalledTimes(2);
    });

    it('loads only customer when expand=customer', async () => {
      paymentRepo.findOneBy.mockResolvedValue(makeMockPayment());

      const result = await controller.findOne('payment-1', { expand: 'customer' });

      expect(result.customer).toEqual({
        id: 'customer-1',
        email: 'customer@example.com',
      });
      expect(result.refunds).toBeUndefined();
      expect(result.paymentLink).toBeUndefined();
      expect(refundRepo.find).not.toHaveBeenCalled();
      expect(dataSource.manager.findOneBy).toHaveBeenCalledTimes(1);
    });

    it('rejects unknown expand keys with BadRequestException (400) before querying', async () => {
      await expect(
        controller.findOne('payment-1', { expand: 'customer,invalidKey' }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(paymentRepo.findOneBy).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('embeds requested relations on list items and rejects unknown expand keys', async () => {
      const qb = {
        andWhere: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[makeMockPayment()], 1]),
      };
      paymentRepo.createQueryBuilder.mockReturnValue(qb);

      const withoutExpand = await controller.findAll({} as any);
      expect(refundRepo.find).not.toHaveBeenCalled();
      expect(dataSource.manager.findOneBy).not.toHaveBeenCalled();
      expect((withoutExpand.data[0] as any).customer).toBeUndefined();

      const withExpand = await controller.findAll({ expand: 'refunds,paymentLink' } as any);
      expect((withExpand.data[0] as any).refunds).toEqual([{ id: 'refund-1', amount: 25 }]);
      expect((withExpand.data[0] as any).paymentLink).toEqual({
        id: 'link-1',
        slug: 'summer-sale',
      });
      expect((withExpand.data[0] as any).customer).toBeUndefined();

      await expect(
        controller.findAll({ expand: 'unknownRelation' } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
