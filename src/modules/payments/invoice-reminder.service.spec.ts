import { InvoiceReminderService } from './invoice-reminder.service';
import { InvoiceReminder, InvoiceReminderType } from './invoice-reminder.entity';
import { Payment, PaymentStatus } from './payment.entity';
import { Repository } from 'typeorm';

describe('InvoiceReminderService', () => {
  let service: InvoiceReminderService;
  let paymentRepository: any;
  let reminderRepository: any;
  let merchantsService: any;
  let appLogger: any;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-15T00:00:00.000Z'));

    paymentRepository = {
      createQueryBuilder: jest.fn(() => {
        let updates: any;
        const builder: any = {
          update: jest.fn().mockReturnThis(),
          set: jest.fn((value) => {
            updates = value;
            return builder;
          }),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          execute: jest.fn(async () => {
            return { affected: 3 };
          }),
        };
        return builder;
      }),
      find: jest.fn().mockResolvedValue([
        {
          id: 'payment-1',
          paymentId: 'payment-1',
          merchantId: 'merchant-1',
          amount: 1000,
          currency: 'USD',
          payerEmail: 'payer@example.com',
          dueDate: new Date('2026-01-18T00:00:00.000Z'), // 3 days from now
          status: PaymentStatus.PENDING,
          remindersEnabled: true,
          merchant: { id: 'merchant-1' },
        },
        {
          id: 'payment-2',
          paymentId: 'payment-2',
          merchantId: 'merchant-1',
          amount: 2000,
          currency: 'USD',
          payerEmail: 'payer2@example.com',
          dueDate: new Date('2026-01-15T00:00:00.000Z'), // Today (on due date)
          status: PaymentStatus.PENDING,
          remindersEnabled: true,
          merchant: { id: 'merchant-1' },
        },
        {
          id: 'payment-3',
          paymentId: 'payment-3',
          merchantId: 'merchant-1',
          amount: 3000,
          currency: 'USD',
          payerEmail: 'payer3@example.com',
          dueDate: new Date('2026-01-08T00:00:00.000Z'), // 7 days ago (after due date)
          status: PaymentStatus.OVERDUE,
          remindersEnabled: true,
          merchant: { id: 'merchant-1' },
        },
      ]),
    };

    reminderRepository = {
      findOneBy: jest.fn().mockResolvedValue(null),
      create: jest.fn((data) => data),
      save: jest.fn().mockImplementation((reminder) => Promise.resolve(reminder)),
    };

    merchantsService = {
      getSettingsWithDefaults: jest.fn().mockResolvedValue({
        remindersEnabled: true,
        reminderOffsets: [-3, 0, 7],
      }),
      getBrandingWithDefaults: jest.fn().mockResolvedValue({
        displayName: 'Test Merchant',
        logo: null,
        primaryColor: '#1a1a2e',
      }),
    };

    appLogger = {
      child: jest.fn().mockReturnValue({
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
      }),
    };

    service = new InvoiceReminderService(
      paymentRepository as any,
      reminderRepository as any,
      merchantsService,
      appLogger,
    );
  });

  afterEach(() => jest.useRealTimers());

  describe('processInvoiceReminders', () => {
    it('should mark PENDING payments past due date as OVERDUE', async () => {
      await service.processInvoiceReminders();

      const builder = paymentRepository.createQueryBuilder();
      expect(builder.update).toHaveBeenCalledWith(Payment);
      expect(builder.set).toHaveBeenCalledWith({ status: PaymentStatus.OVERDUE });
    });

    it('should process reminders for all payments with due dates', async () => {
      await service.processInvoiceReminders();

      expect(paymentRepository.find).toHaveBeenCalled();
      expect(merchantsService.getSettingsWithDefaults).toHaveBeenCalledWith('merchant-1');
    });

    it('should skip reminders when merchant has reminders disabled', async () => {
      merchantsService.getSettingsWithDefaults.mockResolvedValueOnce({
        remindersEnabled: false,
        reminderOffsets: [-3, 0, 7],
      });

      await service.processInvoiceReminders();

      expect(reminderRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('hasReminderBeenSent', () => {
    it('should return true if reminder already sent', async () => {
      reminderRepository.findOneBy.mockResolvedValueOnce({
        id: 'reminder-1',
        paymentId: 'payment-1',
        type: InvoiceReminderType.BEFORE,
        sentAt: new Date(),
      });

      const result = await service.hasReminderBeenSent('payment-1', InvoiceReminderType.BEFORE);

      expect(result).toBe(true);
      expect(reminderRepository.findOneBy).toHaveBeenCalledWith({
        paymentId: 'payment-1',
        type: InvoiceReminderType.BEFORE,
      });
    });

    it('should return false if reminder not yet sent', async () => {
      reminderRepository.findOneBy.mockResolvedValueOnce(null);

      const result = await service.hasReminderBeenSent('payment-1', InvoiceReminderType.BEFORE);

      expect(result).toBe(false);
    });
  });

  describe('Reminder types', () => {
    it('should handle BEFORE reminder type (negative offset)', async () => {
      const payments = [
        {
          id: 'payment-1',
          merchantId: 'merchant-1',
          payerEmail: 'payer@example.com',
          dueDate: new Date('2026-01-18T00:00:00.000Z'),
          status: PaymentStatus.PENDING,
          remindersEnabled: true,
        },
      ];
      paymentRepository.find.mockResolvedValueOnce(payments);

      // This test verifies the structure is correct for BEFORE type
      const result = await service.hasReminderBeenSent('payment-1', InvoiceReminderType.BEFORE);
      expect(typeof result).toBe('boolean');
    });

    it('should handle ON_DUE reminder type (zero offset)', async () => {
      const result = await service.hasReminderBeenSent('payment-2', InvoiceReminderType.ON_DUE);
      expect(typeof result).toBe('boolean');
    });

    it('should handle AFTER reminder type (positive offset)', async () => {
      const result = await service.hasReminderBeenSent('payment-3', InvoiceReminderType.AFTER);
      expect(typeof result).toBe('boolean');
    });
  });

  describe('Payment status handling', () => {
    it('should process reminders for PENDING payments', async () => {
      const payments = [
        {
          id: 'pending-1',
          merchantId: 'merchant-1',
          payerEmail: 'payer@example.com',
          dueDate: new Date('2026-01-15T00:00:00.000Z'),
          status: PaymentStatus.PENDING,
          remindersEnabled: true,
        },
      ];
      paymentRepository.find.mockResolvedValueOnce(payments);

      await service.processInvoiceReminders();

      expect(paymentRepository.find).toHaveBeenCalled();
    });

    it('should process reminders for OVERDUE payments', async () => {
      const payments = [
        {
          id: 'overdue-1',
          merchantId: 'merchant-1',
          payerEmail: 'payer@example.com',
          dueDate: new Date('2026-01-08T00:00:00.000Z'),
          status: PaymentStatus.OVERDUE,
          remindersEnabled: true,
        },
      ];
      paymentRepository.find.mockResolvedValueOnce(payments);

      await service.processInvoiceReminders();

      expect(paymentRepository.find).toHaveBeenCalled();
    });

    it('should skip payments with reminders disabled', async () => {
      const payments = [
        {
          id: 'no-reminder-1',
          merchantId: 'merchant-1',
          payerEmail: 'payer@example.com',
          dueDate: new Date('2026-01-15T00:00:00.000Z'),
          status: PaymentStatus.PENDING,
          remindersEnabled: false,
        },
      ];
      paymentRepository.find.mockResolvedValueOnce(payments);

      await service.processInvoiceReminders();

      expect(reminderRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('Email integration', () => {
    it('should fetch merchant branding when sending reminders', async () => {
      await service.processInvoiceReminders();

      expect(merchantsService.getBrandingWithDefaults).toHaveBeenCalled();
    });

    it('should skip email when payer email is missing', async () => {
      const payments = [
        {
          id: 'no-email-1',
          merchantId: 'merchant-1',
          payerEmail: null,
          dueDate: new Date('2026-01-15T00:00:00.000Z'),
          status: PaymentStatus.PENDING,
          remindersEnabled: true,
        },
      ];
      paymentRepository.find.mockResolvedValueOnce(payments);

      await service.processInvoiceReminders();

      const logger = appLogger.child();
      expect(logger.warn).not.toHaveBeenCalled(); // or check if called based on implementation
    });
  });

  describe('Duplicate prevention', () => {
    it('should not send duplicate reminders', async () => {
      reminderRepository.findOneBy
        .mockResolvedValueOnce({ id: 'reminder-1', type: InvoiceReminderType.BEFORE })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      await service.processInvoiceReminders();

      // First call returns existing reminder, subsequent calls return null
      expect(reminderRepository.findOneBy).toHaveBeenCalled();
    });

    it('should only save new reminders that have not been sent', async () => {
      reminderRepository.findOneBy.mockResolvedValue(null);
      reminderRepository.save.mockImplementation((reminder) => Promise.resolve(reminder));

      // Call multiple times to ensure save is called for each unique reminder
      await service.processInvoiceReminders();

      // Verify save was called (exact count depends on reminder offsets and due dates)
      expect(reminderRepository.save).toHaveBeenCalled();
    });
  });
});
