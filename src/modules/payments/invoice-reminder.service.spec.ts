import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { InvoiceReminderService } from './invoice-reminder.service';
import { Payment, PaymentStatus } from './payment.entity';
import { InvoiceReminder, InvoiceReminderType } from './invoice-reminder.entity';
import { MerchantsService } from '../merchants/merchants.service';
import { AppLogger } from '../logger/logger.service';
import { Repository, UpdateResult } from 'typeorm';

describe('InvoiceReminderService', () => {
  let service: InvoiceReminderService;
  let paymentRepository: any;
  let reminderRepository: any;
  let merchantsService: any;
  let appLogger: any;

  const createMockPayment = (overrides: Partial<Payment> = {}): Payment =>
    ({
      id: 'payment-id-1',
      merchantId: 'merchant-id-1',
      payerEmail: 'payer@example.com',
      amount: 5000,
      currency: 'USD',
      status: PaymentStatus.PENDING,
      dueDate: new Date('2026-02-15T23:59:59.000Z'),
      remindersEnabled: true,
      merchant: { id: 'merchant-id-1' },
      ...overrides,
    } as Payment);

  const createMockReminder = (overrides: Partial<InvoiceReminder> = {}): InvoiceReminder =>
    ({
      id: 'reminder-id-1',
      paymentId: 'payment-id-1',
      type: InvoiceReminderType.BEFORE,
      sentAt: new Date(),
      createdAt: new Date(),
      ...overrides,
    } as InvoiceReminder);

  beforeEach(async () => {
    paymentRepository = {
      find: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    reminderRepository = {
      findOneBy: jest.fn(),
      create: jest.fn((data) => data),
      save: jest.fn(async (reminder) => reminder),
    };

    merchantsService = {
      getSettingsWithDefaults: jest.fn(),
      getBrandingWithDefaults: jest.fn().mockResolvedValue({
        displayName: 'Test Merchant',
        logo: null,
        primaryColor: '#1a1a2e',
      }),
    };

    appLogger = {
      child: jest.fn().mockReturnValue({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvoiceReminderService,
        {
          provide: getRepositoryToken(Payment),
          useValue: paymentRepository,
        },
        {
          provide: getRepositoryToken(InvoiceReminder),
          useValue: reminderRepository,
        },
        {
          provide: MerchantsService,
          useValue: merchantsService,
        },
        {
          provide: AppLogger,
          useValue: appLogger,
        },
      ],
    }).compile();

    service = module.get<InvoiceReminderService>(InvoiceReminderService);
  });

  describe('markOverduePayments', () => {
    it('marks PENDING payments past their dueDate as OVERDUE', async () => {
      const mockQueryBuilder = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 3 }),
      };

      paymentRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      // Call the private method indirectly via processInvoiceReminders
      await service.processInvoiceReminders();

      expect(mockQueryBuilder.update).toHaveBeenCalledWith(Payment);
      expect(mockQueryBuilder.set).toHaveBeenCalledWith({ status: PaymentStatus.OVERDUE });
      expect(mockQueryBuilder.execute).toHaveBeenCalled();
    });

    it('only marks payments with remindersEnabled = true', async () => {
      const mockQueryBuilder = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 0 }),
      };

      paymentRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      await service.processInvoiceReminders();

      // Verify that remindersEnabled filter is applied
      const andWhereCalls = mockQueryBuilder.andWhere.mock.calls;
      const hasRemindersEnabledFilter = andWhereCalls.some((call: any[]) =>
        call[0].includes('remindersEnabled'),
      );
      expect(hasRemindersEnabledFilter).toBe(true);
    });
  });

  describe('hasReminderBeenSent', () => {
    it('returns true if reminder has been sent', async () => {
      const reminder = createMockReminder();
      reminderRepository.findOneBy.mockResolvedValue(reminder);

      const result = await service.hasReminderBeenSent('payment-id-1', InvoiceReminderType.BEFORE);

      expect(result).toBe(true);
      expect(reminderRepository.findOneBy).toHaveBeenCalledWith({
        paymentId: 'payment-id-1',
        type: InvoiceReminderType.BEFORE,
      });
    });

    it('returns false if reminder has not been sent', async () => {
      reminderRepository.findOneBy.mockResolvedValue(null);

      const result = await service.hasReminderBeenSent('payment-id-1', InvoiceReminderType.ON_DUE);

      expect(result).toBe(false);
    });

    it('checks for specific reminder type', async () => {
      reminderRepository.findOneBy.mockResolvedValue(null);

      await service.hasReminderBeenSent('payment-id-1', InvoiceReminderType.AFTER);

      expect(reminderRepository.findOneBy).toHaveBeenCalledWith({
        paymentId: 'payment-id-1',
        type: InvoiceReminderType.AFTER,
      });
    });
  });

  describe('processInvoiceReminders', () => {
    beforeEach(() => {
      merchantsService.getSettingsWithDefaults.mockResolvedValue({
        remindersEnabled: true,
        reminderOffsets: [-3, 0, 7],
      });
    });

    it('skips payments with remindersEnabled = false', async () => {
      const payment = createMockPayment({ remindersEnabled: false });
      const mockQueryBuilder = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 0 }),
      };

      paymentRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);
      paymentRepository.find.mockResolvedValue([payment]);

      await service.processInvoiceReminders();

      // Verify merchant service was not called for disabled payment
      expect(merchantsService.getSettingsWithDefaults).not.toHaveBeenCalledWith('merchant-id-1');
    });

    it('skips payments without a payer email when sending reminders', async () => {
      const payment = createMockPayment({ payerEmail: null });
      const mockQueryBuilder = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 0 }),
      };

      paymentRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);
      paymentRepository.find.mockResolvedValue([payment]);

      await service.processInvoiceReminders();

      // Logger should warn about missing email
      expect(appLogger.child().warn).toHaveBeenCalled();
    });

    it('respects merchant-level remindersEnabled setting', async () => {
      const payment = createMockPayment();
      merchantsService.getSettingsWithDefaults.mockResolvedValue({
        remindersEnabled: false, // Merchant has disabled reminders globally
        reminderOffsets: [-3, 0, 7],
      });

      const mockQueryBuilder = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 0 }),
      };

      paymentRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);
      paymentRepository.find.mockResolvedValue([payment]);

      await service.processInvoiceReminders();

      // Should still call markOverdue, but skip sending reminders
      expect(mockQueryBuilder.execute).toHaveBeenCalled();
    });
  });

  describe('reminder type detection', () => {
    it('identifies BEFORE reminders (negative offset)', async () => {
      const payment = createMockPayment({
        dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 days from now
      });

      merchantsService.getSettingsWithDefaults.mockResolvedValue({
        remindersEnabled: true,
        reminderOffsets: [-3], // 3 days before
      });

      const mockQueryBuilder = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 0 }),
      };

      paymentRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);
      paymentRepository.find.mockResolvedValue([payment]);
      reminderRepository.findOneBy.mockResolvedValue(null);

      await service.processInvoiceReminders();

      // Should attempt to send BEFORE reminder (offset: -3)
      expect(merchantsService.getBrandingWithDefaults).toHaveBeenCalled();
    });

    it('identifies ON_DUE reminders (zero offset)', async () => {
      const payment = createMockPayment({
        dueDate: new Date(new Date().toDateString()), // Today
      });

      merchantsService.getSettingsWithDefaults.mockResolvedValue({
        remindersEnabled: true,
        reminderOffsets: [0], // On due date
      });

      const mockQueryBuilder = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 0 }),
      };

      paymentRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);
      paymentRepository.find.mockResolvedValue([payment]);
      reminderRepository.findOneBy.mockResolvedValue(null);

      await service.processInvoiceReminders();

      expect(merchantsService.getBrandingWithDefaults).toHaveBeenCalled();
    });

    it('identifies AFTER reminders (positive offset)', async () => {
      const payment = createMockPayment({
        dueDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
        status: PaymentStatus.OVERDUE,
      });

      merchantsService.getSettingsWithDefaults.mockResolvedValue({
        remindersEnabled: true,
        reminderOffsets: [7], // 7 days after due date
      });

      const mockQueryBuilder = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      };

      paymentRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);
      paymentRepository.find.mockResolvedValue([payment]);
      reminderRepository.findOneBy.mockResolvedValue(null);

      await service.processInvoiceReminders();

      expect(merchantsService.getBrandingWithDefaults).toHaveBeenCalled();
    });
  });

  describe('duplicate prevention', () => {
    it('does not send the same reminder twice', async () => {
      const payment = createMockPayment();
      const existingReminder = createMockReminder({
        type: InvoiceReminderType.BEFORE,
        sentAt: new Date(Date.now() - 1 * 60 * 1000), // Sent 1 minute ago
      });

      merchantsService.getSettingsWithDefaults.mockResolvedValue({
        remindersEnabled: true,
        reminderOffsets: [-3],
      });

      const mockQueryBuilder = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 0 }),
      };

      paymentRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);
      paymentRepository.find.mockResolvedValue([payment]);
      reminderRepository.findOneBy.mockResolvedValue(existingReminder);

      await service.processInvoiceReminders();

      // Reminder should not be saved again
      expect(reminderRepository.save).not.toHaveBeenCalled();
    });

    it('saves a new reminder if not previously sent', async () => {
      const payment = createMockPayment({
        dueDate: new Date(new Date().toDateString()), // Today
      });

      merchantsService.getSettingsWithDefaults.mockResolvedValue({
        remindersEnabled: true,
        reminderOffsets: [0], // On due date
      });

      const mockQueryBuilder = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 0 }),
      };

      paymentRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);
      paymentRepository.find.mockResolvedValue([payment]);
      reminderRepository.findOneBy.mockResolvedValue(null); // No previous reminder

      await service.processInvoiceReminders();

      expect(reminderRepository.create).toHaveBeenCalled();
      expect(reminderRepository.save).toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('handles payments without dueDate gracefully', async () => {
      const payment = createMockPayment({ dueDate: null });

      merchantsService.getSettingsWithDefaults.mockResolvedValue({
        remindersEnabled: true,
        reminderOffsets: [-3, 0, 7],
      });

      const mockQueryBuilder = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 0 }),
      };

      paymentRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);
      paymentRepository.find.mockResolvedValue([payment]);

      // Should not throw
      await expect(service.processInvoiceReminders()).resolves.not.toThrow();
    });

    it('handles missing merchant gracefully', async () => {
      const payment = createMockPayment({ merchantId: null });

      merchantsService.getSettingsWithDefaults.mockResolvedValue({
        remindersEnabled: true,
        reminderOffsets: [-3, 0, 7],
      });

      const mockQueryBuilder = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 0 }),
      };

      paymentRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);
      paymentRepository.find.mockResolvedValue([payment]);

      // Should not throw
      await expect(service.processInvoiceReminders()).resolves.not.toThrow();
    });

    it('processes multiple payments in a single cron run', async () => {
      const payments = [
        createMockPayment({ id: 'payment-1', merchantId: 'merchant-1' }),
        createMockPayment({ id: 'payment-2', merchantId: 'merchant-2' }),
        createMockPayment({ id: 'payment-3', merchantId: 'merchant-1' }),
      ];

      merchantsService.getSettingsWithDefaults.mockResolvedValue({
        remindersEnabled: true,
        reminderOffsets: [-3],
      });

      const mockQueryBuilder = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 0 }),
      };

      paymentRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);
      paymentRepository.find.mockResolvedValue(payments);
      reminderRepository.findOneBy.mockResolvedValue(null);

      await service.processInvoiceReminders();

      expect(paymentRepository.find).toHaveBeenCalled();
    });
  });
});
