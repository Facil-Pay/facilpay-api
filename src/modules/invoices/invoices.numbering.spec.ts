import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { InvoicesService } from './invoices.service';
import { Invoice, InvoiceStatus } from './invoice.entity';
import { InvoiceSequence } from './entities/invoice-sequence.entity';
import { MerchantSettings } from '../merchants/entities/merchant-settings.entity';
import { ProductsService } from '../products/products.service';
import { EmailNotificationService } from '../notifications/email-notification.service';
import { PaymentsService } from '../payments/payments.service';
import { ConfigService } from '@nestjs/config';
import { WebhooksService } from '../webhooks/webhooks.service';

describe('InvoicesService - Numbering', () => {
  let service: InvoicesService;
  let sequenceRepository: Repository<InvoiceSequence>;
  let merchantSettingsRepository: Repository<MerchantSettings>;
  let dataSource: DataSource;

  const mockQueryRunner = {
    connect: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    release: jest.fn(),
    query: jest.fn(),
    manager: {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvoicesService,
        {
          provide: getRepositoryToken(Invoice),
          useValue: {
            find: jest.fn(),
            findOne: jest.fn(),
            save: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(InvoiceSequence),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(MerchantSettings),
          useValue: {
            findOne: jest.fn(),
          },
        },
        {
          provide: DataSource,
          useValue: {
            createQueryRunner: jest.fn(() => mockQueryRunner),
          },
        },
        {
          provide: ProductsService,
          useValue: { validateAndGetProduct: jest.fn() },
        },
        {
          provide: EmailNotificationService,
          useValue: { sendInvoiceCreated: jest.fn() },
        },
        {
          provide: PaymentsService,
          useValue: {},
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn(() => 'http://localhost:3000') },
        },
        {
          provide: WebhooksService,
          useValue: { dispatchEventToMerchant: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<InvoicesService>(InvoicesService);
    sequenceRepository = module.get(getRepositoryToken(InvoiceSequence));
    merchantSettingsRepository = module.get(getRepositoryToken(MerchantSettings));
    dataSource = module.get<DataSource>(DataSource);
  });

  describe('configurable invoice numbering', () => {
    it('should use default prefix and padding when no settings exist', async () => {
      const merchantId = 'merchant-1';
      
      jest.spyOn(merchantSettingsRepository, 'findOne').mockResolvedValue(null);

      // Call the private formatInvoiceNumber method via reflection
      const result = await (service as any).formatInvoiceNumber(merchantId, 42);

      expect(result).toBe('INV-000042');
    });

    it('should use custom prefix and padding from merchant settings', async () => {
      const merchantId = 'merchant-1';
      const settings = {
        merchantId,
        invoicePrefix: '2024-INV',
        invoiceNumberPadding: 4,
      } as MerchantSettings;

      jest.spyOn(merchantSettingsRepository, 'findOne').mockResolvedValue(settings);

      const result = await (service as any).formatInvoiceNumber(merchantId, 42);

      expect(result).toBe('2024-INV-0042');
    });

    it('should increment sequence independently for each merchant', async () => {
      const merchantId1 = 'merchant-1';
      const merchantId2 = 'merchant-2';

      mockQueryRunner.manager.findOne
        .mockResolvedValueOnce(null) // First merchant, no sequence exists
        .mockResolvedValueOnce(null); // Second merchant, no sequence exists

      mockQueryRunner.manager.create
        .mockImplementation((entity, data) => ({ ...data, id: 'new-sequence' }));

      mockQueryRunner.manager.save.mockResolvedValue({ lastNumber: 1 });

      const invoice1 = { id: 'inv-1', merchantId: merchantId1, number: 1 } as Invoice;
      const invoice2 = { id: 'inv-2', merchantId: merchantId2, number: 1 } as Invoice;

      await (service as any).assignFinalInvoiceNumber(merchantId1, invoice1);
      await (service as any).assignFinalInvoiceNumber(merchantId2, invoice2);

      expect(invoice1.number).toBe(1);
      expect(invoice2.number).toBe(1);
      expect(mockQueryRunner.manager.save).toHaveBeenCalledTimes(4); // 2 sequences + 2 invoices
    });

    it('should reset sequence yearly when configured', async () => {
      const merchantId = 'merchant-1';
      const settings = {
        merchantId,
        resetSequence: 'yearly',
      } as MerchantSettings;

      jest.spyOn(merchantSettingsRepository, 'findOne').mockResolvedValue(settings);

      const currentYear = new Date().getFullYear();

      mockQueryRunner.manager.findOne.mockResolvedValue(null); // No sequence for this year
      mockQueryRunner.manager.create.mockImplementation((entity, data) => ({
        ...data,
        id: 'seq-1',
      }));
      mockQueryRunner.manager.save.mockResolvedValue({
        merchantId,
        year: currentYear,
        lastNumber: 1,
      });

      const invoice = { id: 'inv-1', merchantId, number: 0 } as Invoice;

      await (service as any).assignFinalInvoiceNumber(merchantId, invoice);

      expect(mockQueryRunner.manager.create).toHaveBeenCalledWith(
        InvoiceSequence,
        expect.objectContaining({
          merchantId,
          year: currentYear,
          lastNumber: 0,
        }),
      );
    });

    it('should not reset sequence when configured as never', async () => {
      const merchantId = 'merchant-1';
      const settings = {
        merchantId,
        resetSequence: 'never',
      } as MerchantSettings;

      jest.spyOn(merchantSettingsRepository, 'findOne').mockResolvedValue(settings);

      mockQueryRunner.manager.findOne.mockResolvedValue(null);
      mockQueryRunner.manager.create.mockImplementation((entity, data) => ({
        ...data,
        id: 'seq-1',
      }));

      const invoice = { id: 'inv-1', merchantId, number: 0 } as Invoice;

      await (service as any).assignFinalInvoiceNumber(merchantId, invoice);

      expect(mockQueryRunner.manager.create).toHaveBeenCalledWith(
        InvoiceSequence,
        expect.objectContaining({
          merchantId,
          year: null,
        }),
      );
    });

    it('should handle concurrent invoice finalizations without gaps', async () => {
      const merchantId = 'merchant-1';
      const existingSequence = {
        id: 'seq-1',
        merchantId,
        year: null,
        lastNumber: 10,
      };

      mockQueryRunner.manager.findOne.mockResolvedValue(existingSequence);
      mockQueryRunner.manager.save.mockImplementation((entity) => {
        if (entity.lastNumber) {
          return Promise.resolve({ ...entity });
        }
        return Promise.resolve(entity);
      });

      const invoice = { id: 'inv-1', merchantId, number: 0 } as Invoice;

      await (service as any).assignFinalInvoiceNumber(merchantId, invoice);

      expect(invoice.number).toBe(11);
      expect(mockQueryRunner.query).toHaveBeenCalledWith(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        [merchantId],
      );
    });
  });
});
