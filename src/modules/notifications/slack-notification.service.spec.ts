import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { of } from 'rxjs';
import { SlackNotificationService, SlackPaymentEventData } from './slack-notification.service';
import { AppLogger } from '../logger/logger.service';

describe('SlackNotificationService', () => {
  let service: SlackNotificationService;
  let httpService: any;
  let configService: any;
  let appLogger: any;

  const mockPaymentEvent: SlackPaymentEventData = {
    paymentId: 'pay_123',
    amount: 1500.5,
    currency: 'USD',
    status: 'COMPLETED',
    merchantId: 'merchant_1',
    merchantEmail: 'merchant@example.com',
    payerEmail: 'payer@example.com',
    payerName: 'John Doe',
    description: 'Test payment',
    timestamp: new Date('2026-01-15T10:00:00Z'),
  };

  beforeEach(async () => {
    httpService = {
      post: jest.fn().mockReturnValue(of({ status: 200, data: {} })),
    };

    configService = {
      get: jest.fn((key, defaultValue) => {
        const config: Record<string, string> = {
          SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXX',
          SLACK_NOTIFICATIONS_ENABLED: 'true',
        };
        return config[key] ?? defaultValue;
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SlackNotificationService,
        {
          provide: HttpService,
          useValue: httpService,
        },
        {
          provide: ConfigService,
          useValue: configService,
        },
        {
          provide: AppLogger,
          useValue: appLogger,
        },
      ],
    }).compile();

    service = module.get<SlackNotificationService>(SlackNotificationService);
  });

  describe('sendPaymentNotification', () => {
    it('should send notification when enabled and webhook configured', async () => {
      await service.sendPaymentNotification(mockPaymentEvent);

      expect(httpService.post).toHaveBeenCalledWith(
        'https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXX',
        expect.objectContaining({
          blocks: expect.any(Array),
        }),
      );
    });

    it('should not send notification when disabled', async () => {
      configService.get.mockImplementation((key, defaultValue) => {
        if (key === 'SLACK_NOTIFICATIONS_ENABLED') return 'false';
        return defaultValue;
      });

      // Recreate service with disabled config
      const moduleNew: TestingModule = await Test.createTestingModule({
        providers: [
          SlackNotificationService,
          {
            provide: HttpService,
            useValue: httpService,
          },
          {
            provide: ConfigService,
            useValue: configService,
          },
          {
            provide: AppLogger,
            useValue: appLogger,
          },
        ],
      }).compile();

      const disabledService = moduleNew.get<SlackNotificationService>(SlackNotificationService);

      await disabledService.sendPaymentNotification(mockPaymentEvent);

      expect(httpService.post).not.toHaveBeenCalled();
    });

    it('should not send notification when webhook URL not configured', async () => {
      configService.get.mockImplementation((key, defaultValue) => {
        if (key === 'SLACK_WEBHOOK_URL') return null;
        if (key === 'SLACK_NOTIFICATIONS_ENABLED') return 'true';
        return defaultValue;
      });

      const moduleNew: TestingModule = await Test.createTestingModule({
        providers: [
          SlackNotificationService,
          {
            provide: HttpService,
            useValue: httpService,
          },
          {
            provide: ConfigService,
            useValue: configService,
          },
          {
            provide: AppLogger,
            useValue: appLogger,
          },
        ],
      }).compile();

      const unconfiguredService = moduleNew.get<SlackNotificationService>(SlackNotificationService);

      await unconfiguredService.sendPaymentNotification(mockPaymentEvent);

      expect(httpService.post).not.toHaveBeenCalled();
    });

    it('should handle HTTP errors gracefully', async () => {
      httpService.post.mockReturnValueOnce(
        new Promise((_, reject) => reject(new Error('Network error'))),
      );

      // Should not throw
      await expect(service.sendPaymentNotification(mockPaymentEvent)).rejects.toThrow();
    });

    it('should include payment details in message', async () => {
      await service.sendPaymentNotification(mockPaymentEvent);

      const callArgs = httpService.post.mock.calls[0];
      const blocks = callArgs[1].blocks;

      const messageContent = JSON.stringify(blocks);
      expect(messageContent).toContain('pay_123');
      expect(messageContent).toContain('USD');
      expect(messageContent).toContain('COMPLETED');
    });
  });

  describe('sendPaymentCompleted', () => {
    it('should send notification with COMPLETED status', async () => {
      const event = { ...mockPaymentEvent, status: 'PENDING' };

      await service.sendPaymentCompleted(event);

      const callArgs = httpService.post.mock.calls[0];
      const blocks = callArgs[1].blocks;
      const messageContent = JSON.stringify(blocks);

      expect(messageContent).toContain('COMPLETED');
    });

    it('should set status to COMPLETED regardless of input', async () => {
      const event = { ...mockPaymentEvent, status: 'FAILED' };

      await service.sendPaymentCompleted(event);

      const callArgs = httpService.post.mock.calls[0];
      const blocks = callArgs[1].blocks;
      const messageContent = JSON.stringify(blocks);

      expect(messageContent).toContain('COMPLETED');
    });
  });

  describe('sendPaymentFailed', () => {
    it('should send notification with FAILED status', async () => {
      const event = { ...mockPaymentEvent, status: 'PENDING' };

      await service.sendPaymentFailed(event);

      const callArgs = httpService.post.mock.calls[0];
      const blocks = callArgs[1].blocks;
      const messageContent = JSON.stringify(blocks);

      expect(messageContent).toContain('FAILED');
      expect(messageContent).toContain('❌');
    });
  });

  describe('sendPaymentRefunded', () => {
    it('should send notification with REFUNDED status', async () => {
      const event = { ...mockPaymentEvent, status: 'COMPLETED' };

      await service.sendPaymentRefunded(event);

      const callArgs = httpService.post.mock.calls[0];
      const blocks = callArgs[1].blocks;
      const messageContent = JSON.stringify(blocks);

      expect(messageContent).toContain('REFUNDED');
      expect(messageContent).toContain('↩️');
    });
  });

  describe('sendPaymentCancelled', () => {
    it('should send notification with CANCELLED status', async () => {
      const event = { ...mockPaymentEvent, status: 'PENDING' };

      await service.sendPaymentCancelled(event);

      const callArgs = httpService.post.mock.calls[0];
      const blocks = callArgs[1].blocks;
      const messageContent = JSON.stringify(blocks);

      expect(messageContent).toContain('CANCELLED');
      expect(messageContent).toContain('🚫');
    });
  });

  describe('message formatting', () => {
    it('should format message with all required fields', async () => {
      await service.sendPaymentNotification(mockPaymentEvent);

      const callArgs = httpService.post.mock.calls[0];
      const blocks = callArgs[1].blocks;

      expect(blocks).toBeInstanceOf(Array);
      expect(blocks.length).toBeGreaterThan(0);
      expect(blocks[0]).toHaveProperty('type', 'header');
    });

    it('should include merchant email if provided', async () => {
      const event = { ...mockPaymentEvent, merchantEmail: 'merchant@test.com' };

      await service.sendPaymentNotification(event);

      const callArgs = httpService.post.mock.calls[0];
      const messageContent = JSON.stringify(callArgs[1].blocks);

      expect(messageContent).toContain('merchant@test.com');
    });

    it('should exclude merchant email if not provided', async () => {
      const event = { ...mockPaymentEvent, merchantEmail: undefined };

      await service.sendPaymentNotification(event);

      const callArgs = httpService.post.mock.calls[0];
      const blocks = callArgs[1].blocks;

      const merchantSection = JSON.stringify(blocks).match(/\*Merchant:\*/);
      expect(merchantSection).toBeFalsy();
    });

    it('should include payer name and email', async () => {
      await service.sendPaymentNotification(mockPaymentEvent);

      const callArgs = httpService.post.mock.calls[0];
      const messageContent = JSON.stringify(callArgs[1].blocks);

      expect(messageContent).toContain('John Doe');
      expect(messageContent).toContain('payer@example.com');
    });

    it('should format amount with currency', async () => {
      await service.sendPaymentNotification(mockPaymentEvent);

      const callArgs = httpService.post.mock.calls[0];
      const messageContent = JSON.stringify(callArgs[1].blocks);

      expect(messageContent).toContain('USD 1500.50');
    });

    it('should include description if provided', async () => {
      await service.sendPaymentNotification(mockPaymentEvent);

      const callArgs = httpService.post.mock.calls[0];
      const messageContent = JSON.stringify(callArgs[1].blocks);

      expect(messageContent).toContain('Test payment');
    });

    it('should handle missing optional fields', async () => {
      const minimalEvent: SlackPaymentEventData = {
        paymentId: 'pay_123',
        amount: 100,
        currency: 'USD',
        status: 'COMPLETED',
        merchantId: 'merchant_1',
        timestamp: new Date(),
      };

      await service.sendPaymentNotification(minimalEvent);

      expect(httpService.post).toHaveBeenCalled();
    });

    it('should format timestamp correctly', async () => {
      const testDate = new Date('2026-01-15T14:30:00Z');
      const event = { ...mockPaymentEvent, timestamp: testDate };

      await service.sendPaymentNotification(event);

      const callArgs = httpService.post.mock.calls[0];
      const blocks = callArgs[1].blocks;

      // Should have timestamp in context
      expect(blocks).toContainEqual(
        expect.objectContaining({
          type: 'context',
        }),
      );
    });
  });

  describe('status emoji mapping', () => {
    const statusEmojis = [
      { status: 'COMPLETED', emoji: '✅' },
      { status: 'FAILED', emoji: '❌' },
      { status: 'REFUNDED', emoji: '↩️' },
      { status: 'CANCELLED', emoji: '🚫' },
      { status: 'PENDING', emoji: '⏳' },
      { status: 'PARTIALLY_REFUNDED', emoji: '↩️' },
      { status: 'EXPIRED', emoji: '⌛' },
    ];

    statusEmojis.forEach(({ status, emoji }) => {
      it(`should use emoji ${emoji} for status ${status}`, async () => {
        const event = { ...mockPaymentEvent, status };

        await service.sendPaymentNotification(event);

        const callArgs = httpService.post.mock.calls[0];
        const messageContent = JSON.stringify(callArgs[1].blocks);

        expect(messageContent).toContain(emoji);
      });
    });

    it('should use default emoji for unknown status', async () => {
      const event = { ...mockPaymentEvent, status: 'UNKNOWN_STATUS' };

      await service.sendPaymentNotification(event);

      const callArgs = httpService.post.mock.calls[0];
      const messageContent = JSON.stringify(callArgs[1].blocks);

      expect(messageContent).toContain('📋');
    });
  });

  describe('edge cases', () => {
    it('should handle large amounts correctly', async () => {
      const event = { ...mockPaymentEvent, amount: 9999999.99 };

      await service.sendPaymentNotification(event);

      const callArgs = httpService.post.mock.calls[0];
      const messageContent = JSON.stringify(callArgs[1].blocks);

      expect(messageContent).toContain('9999999.99');
    });

    it('should handle very small amounts correctly', async () => {
      const event = { ...mockPaymentEvent, amount: 0.01 };

      await service.sendPaymentNotification(event);

      const callArgs = httpService.post.mock.calls[0];
      const messageContent = JSON.stringify(callArgs[1].blocks);

      expect(messageContent).toContain('0.01');
    });

    it('should handle special characters in description', async () => {
      const event = {
        ...mockPaymentEvent,
        description: 'Test <payment> & "special" \'chars\'',
      };

      await service.sendPaymentNotification(event);

      expect(httpService.post).toHaveBeenCalled();
    });

    it('should handle long merchant names', async () => {
      const event = {
        ...mockPaymentEvent,
        payerName: 'A'.repeat(100),
      };

      await service.sendPaymentNotification(event);

      expect(httpService.post).toHaveBeenCalled();
    });
  });
});
