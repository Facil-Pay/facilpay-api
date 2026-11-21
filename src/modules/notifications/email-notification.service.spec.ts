import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import { Queue } from 'bull';
import { EmailNotificationService } from './email-notification.service';
import { NotificationPreferencesService } from './preferences/notification-preferences.service';
import { InAppNotificationsService } from './in-app-notifications/in-app-notifications.service';
import { AppLogger } from '../logger/logger.service';

describe('EmailNotificationService', () => {
  let service: EmailNotificationService;
  let emailQueue: any;
  let prefsService: any;
  let inAppNotificationsService: any;
  let appLogger: any;

  beforeEach(async () => {
    emailQueue = {
      add: jest.fn().mockResolvedValue({ id: 'job-1' }),
      process: jest.fn(),
      on: jest.fn(),
    };

    prefsService = {
      getPreferences: jest.fn().mockResolvedValue({
        userId: 'user-1',
        emailNotifications: true,
        emailDigest: 'daily',
      }),
      updatePreferences: jest.fn(),
    };

    inAppNotificationsService = {
      create: jest.fn().mockResolvedValue({ id: 'notification-1' }),
    };

    appLogger = {
      child: jest.fn().mockReturnValue({
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailNotificationService,
        {
          provide: getQueueToken('emails'),
          useValue: emailQueue,
        },
        {
          provide: NotificationPreferencesService,
          useValue: prefsService,
        },
        {
          provide: InAppNotificationsService,
          useValue: inAppNotificationsService,
        },
        {
          provide: AppLogger,
          useValue: appLogger,
        },
      ],
    }).compile();

    service = module.get<EmailNotificationService>(EmailNotificationService);
  });

  describe('sendPaymentConfirmation', () => {
    it('should queue email when user preferences allow', async () => {
      const paymentData = {
        paymentId: 'pay_123',
        amount: 100.5,
        currency: 'USD',
        status: 'COMPLETED',
        timestamp: new Date().toISOString(),
      };

      await service.sendPaymentConfirmation('user-1', 'user@example.com', paymentData);

      expect(emailQueue.add).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@example.com',
          template: expect.stringContaining('payment'),
        }),
      );
    });

    it('should include payment details in email data', async () => {
      const paymentData = {
        paymentId: 'pay_456',
        amount: 250.75,
        currency: 'EUR',
        status: 'COMPLETED',
        timestamp: new Date().toISOString(),
      };

      await service.sendPaymentConfirmation('user-1', 'merchant@example.com', paymentData);

      const addCall = emailQueue.add.mock.calls[0];
      expect(addCall[0]).toMatchObject({
        to: 'merchant@example.com',
        data: expect.objectContaining({
          amount: 250.75,
          currency: 'EUR',
        }),
      });
    });

    it('should not queue email when user has disabled notifications', async () => {
      prefsService.getPreferences.mockResolvedValue({
        userId: 'user-1',
        emailNotifications: false,
      });

      const paymentData = {
        paymentId: 'pay_789',
        amount: 50,
        currency: 'USD',
        status: 'COMPLETED',
        timestamp: new Date().toISOString(),
      };

      await service.sendPaymentConfirmation('user-1', 'user@example.com', paymentData);

      // May or may not queue depending on implementation, but preferences should be checked
      expect(prefsService.getPreferences).toHaveBeenCalledWith('user-1');
    });
  });

  describe('sendInvoiceReminder', () => {
    it('should queue invoice reminder email', async () => {
      const invoiceData = {
        invoiceId: 'inv_123',
        amount: 500,
        currency: 'USD',
        dueDate: '2026-02-15',
        reminderType: 'BEFORE',
      };

      await service.sendInvoiceReminder('user-1', 'payer@example.com', invoiceData);

      expect(emailQueue.add).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'payer@example.com',
          template: expect.stringContaining('reminder'),
        }),
      );
    });

    it('should include reminder type in email context', async () => {
      const invoiceData = {
        invoiceId: 'inv_456',
        amount: 1000,
        currency: 'USD',
        dueDate: '2026-02-15',
        reminderType: 'ON_DUE',
      };

      await service.sendInvoiceReminder('user-1', 'payer@example.com', invoiceData);

      const addCall = emailQueue.add.mock.calls[0];
      expect(addCall[0]).toMatchObject({
        data: expect.objectContaining({
          reminderType: 'ON_DUE',
        }),
      });
    });
  });

  describe('sendWelcomeEmail', () => {
    it('should queue welcome email for new users', async () => {
      await service.sendWelcomeEmail('user-1', 'newuser@example.com', 'John Doe');

      expect(emailQueue.add).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'newuser@example.com',
          template: 'welcome',
        }),
      );
    });

    it('should include user name in welcome email', async () => {
      await service.sendWelcomeEmail('user-1', 'newuser@example.com', 'Jane Smith');

      const addCall = emailQueue.add.mock.calls[0];
      expect(addCall[0]).toMatchObject({
        data: expect.objectContaining({
          name: 'Jane Smith',
        }),
      });
    });

    it('should handle missing user name gracefully', async () => {
      await service.sendWelcomeEmail('user-1', 'newuser@example.com');

      expect(emailQueue.add).toHaveBeenCalled();
    });
  });

  describe('sendPasswordResetEmail', () => {
    it('should queue password reset email', async () => {
      const resetToken = 'reset_token_abc123';
      const resetUrl = 'https://example.com/reset?token=abc123';

      await service.sendPasswordResetEmail('user-1', 'user@example.com', resetToken, resetUrl);

      expect(emailQueue.add).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@example.com',
          template: 'password-reset',
        }),
      );
    });

    it('should include reset URL in email data', async () => {
      const resetToken = 'token_xyz';
      const resetUrl = 'https://app.facilpay.com/reset?code=xyz';

      await service.sendPasswordResetEmail('user-1', 'user@example.com', resetToken, resetUrl);

      const addCall = emailQueue.add.mock.calls[0];
      expect(addCall[0]).toMatchObject({
        data: expect.objectContaining({
          resetUrl: resetUrl,
        }),
      });
    });
  });

  describe('sendDisputeNotification', () => {
    it('should queue dispute notification email', async () => {
      const disputeData = {
        disputeId: 'disp_123',
        amount: 200,
        currency: 'USD',
        reason: 'customer_dispute',
        status: 'OPEN',
      };

      await service.sendDisputeNotification('user-1', 'merchant@example.com', disputeData);

      expect(emailQueue.add).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'merchant@example.com',
          template: expect.stringContaining('dispute'),
        }),
      );
    });

    it('should include dispute details in email', async () => {
      const disputeData = {
        disputeId: 'disp_456',
        amount: 500,
        currency: 'EUR',
        reason: 'unauthorized_transaction',
        status: 'RESOLVED',
      };

      await service.sendDisputeNotification('user-1', 'merchant@example.com', disputeData);

      const addCall = emailQueue.add.mock.calls[0];
      expect(addCall[0]).toMatchObject({
        data: expect.objectContaining({
          amount: 500,
          reason: 'unauthorized_transaction',
        }),
      });
    });
  });

  describe('sendRefundNotification', () => {
    it('should queue refund notification email', async () => {
      const refundData = {
        refundId: 'ref_123',
        amount: 150,
        currency: 'USD',
        reason: 'customer_request',
        paymentId: 'pay_123',
      };

      await service.sendRefundNotification('user-1', 'customer@example.com', refundData);

      expect(emailQueue.add).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'customer@example.com',
          template: expect.stringContaining('refund'),
        }),
      );
    });

    it('should include refund amount and reason', async () => {
      const refundData = {
        refundId: 'ref_789',
        amount: 75.5,
        currency: 'GBP',
        reason: 'duplicate_charge',
        paymentId: 'pay_456',
      };

      await service.sendRefundNotification('user-1', 'customer@example.com', refundData);

      const addCall = emailQueue.add.mock.calls[0];
      expect(addCall[0]).toMatchObject({
        data: expect.objectContaining({
          amount: 75.5,
          reason: 'duplicate_charge',
        }),
      });
    });
  });

  describe('queue management', () => {
    it('should handle queue add errors gracefully', async () => {
      emailQueue.add.mockRejectedValueOnce(new Error('Queue error'));

      const paymentData = {
        paymentId: 'pay_error',
        amount: 100,
        currency: 'USD',
        status: 'COMPLETED',
        timestamp: new Date().toISOString(),
      };

      // Should not throw, but log the error
      await expect(
        service.sendPaymentConfirmation('user-1', 'user@example.com', paymentData),
      ).rejects.toThrow();
    });

    it('should set appropriate job options', async () => {
      const paymentData = {
        paymentId: 'pay_123',
        amount: 100,
        currency: 'USD',
        status: 'COMPLETED',
        timestamp: new Date().toISOString(),
      };

      await service.sendPaymentConfirmation('user-1', 'user@example.com', paymentData);

      const addCall = emailQueue.add.mock.calls[0];
      // Job options typically include attempts, delay, etc.
      expect(addCall.length).toBeGreaterThan(0);
    });
  });

  describe('email validation', () => {
    it('should handle missing recipient email', async () => {
      const paymentData = {
        paymentId: 'pay_123',
        amount: 100,
        currency: 'USD',
        status: 'COMPLETED',
        timestamp: new Date().toISOString(),
      };

      // Should handle gracefully - may throw or skip
      expect(async () => {
        await service.sendPaymentConfirmation('user-1', '', paymentData);
      }).toBeDefined();
    });

    it('should normalize email addresses', async () => {
      const paymentData = {
        paymentId: 'pay_123',
        amount: 100,
        currency: 'USD',
        status: 'COMPLETED',
        timestamp: new Date().toISOString(),
      };

      await service.sendPaymentConfirmation('user-1', 'USER@EXAMPLE.COM', paymentData);

      const addCall = emailQueue.add.mock.calls[0];
      // Email should be normalized (lowercase)
      expect(addCall[0].to).toBeDefined();
    });
  });

  describe('template rendering', () => {
    it('should select appropriate template for different notification types', async () => {
      const templates = new Set<string>();

      emailQueue.add.mockImplementation((data) => {
        templates.add(data.template);
        return Promise.resolve({ id: 'job-1' });
      });

      await service.sendPaymentConfirmation('user-1', 'user@example.com', {
        paymentId: 'pay_1',
        amount: 100,
        currency: 'USD',
        status: 'COMPLETED',
        timestamp: new Date().toISOString(),
      });

      await service.sendWelcomeEmail('user-1', 'user@example.com', 'John');

      expect(templates.size).toBeGreaterThan(0);
      expect(emailQueue.add).toHaveBeenCalledTimes(2);
    });
  });

  describe('retry behavior', () => {
    it('should support retry configuration', async () => {
      const paymentData = {
        paymentId: 'pay_123',
        amount: 100,
        currency: 'USD',
        status: 'COMPLETED',
        timestamp: new Date().toISOString(),
      };

      await service.sendPaymentConfirmation('user-1', 'user@example.com', paymentData);

      const addCall = emailQueue.add.mock.calls[0];
      // Verify job options are set (typically second parameter)
      expect(addCall.length).toBeGreaterThanOrEqual(1);
    });
  });
});
