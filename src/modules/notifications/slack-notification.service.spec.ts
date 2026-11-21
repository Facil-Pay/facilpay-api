import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { SlackNotificationService, SlackPaymentEventData } from './slack-notification.service';
import { AppLogger } from '../logger/logger.service';

describe('SlackNotificationService', () => {
  let service: SlackNotificationService;
  let httpService: jest.Mocked<HttpService>;
  let configService: jest.Mocked<ConfigService>;
  let appLogger: jest.Mocked<AppLogger>;

  const mockWebhookUrl = 'https://hooks.slack.com/services/MOCK/WEBHOOK/URL';

  const createMockPaymentEvent = (overrides?: Partial<SlackPaymentEventData>): SlackPaymentEventData => ({
    paymentId: 'pay_123456',
    amount: 100.00,
    currency: 'USD',
    status: 'COMPLETED',
    merchantId: 'merc_123',
    merchantEmail: 'merchant@example.com',
    payerEmail: 'payer@example.com',
    payerName: 'John Doe',
    description: 'Test payment',
    timestamp: new Date('2026-01-15T10:30:00Z'),
    ...overrides,
  });

  beforeEach(async () => {
    httpService = {
      post: jest.fn().mockReturnValue(of({ data: {} })),
    } as any;

    configService = {
      get: jest.fn((key: string, defaultValue?: any) => {
        if (key === 'SLACK_WEBHOOK_URL') return mockWebhookUrl;
        if (key === 'SLACK_NOTIFICATIONS_ENABLED') return 'true';
        return defaultValue;
      }),
    } as any;

    appLogger = {
      child: jest.fn().mockReturnValue({
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      }),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SlackNotificationService,
        { provide: HttpService, useValue: httpService },
        { provide: ConfigService, useValue: configService },
        { provide: AppLogger, useValue: appLogger },
      ],
    }).compile();

    service = module.get<SlackNotificationService>(SlackNotificationService);
  });

  describe('sendPaymentNotification', () => {
    it('should send a Slack message when notifications are enabled', async () => {
      const event = createMockPaymentEvent();
      await service.sendPaymentNotification(event);

      expect(httpService.post).toHaveBeenCalledWith(
        mockWebhookUrl,
        expect.objectContaining({
          blocks: expect.any(Array),
        }),
      );
    });

    it('should not send a message when Slack is disabled', async () => {
      configService.get = jest.fn((key: string) => {
        if (key === 'SLACK_NOTIFICATIONS_ENABLED') return 'false';
        return null;
      });

      // Recreate service with disabled config
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          SlackNotificationService,
          { provide: HttpService, useValue: httpService },
          { provide: ConfigService, useValue: configService },
          { provide: AppLogger, useValue: appLogger },
        ],
      }).compile();

      const disabledService = module.get<SlackNotificationService>(SlackNotificationService);
      const event = createMockPaymentEvent();
      await disabledService.sendPaymentNotification(event);

      expect(httpService.post).not.toHaveBeenCalled();
    });

    it('should not send a message when webhook URL is not configured', async () => {
      configService.get = jest.fn((key: string) => {
        if (key === 'SLACK_WEBHOOK_URL') return null;
        if (key === 'SLACK_NOTIFICATIONS_ENABLED') return 'true';
        return null;
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          SlackNotificationService,
          { provide: HttpService, useValue: httpService },
          { provide: ConfigService, useValue: configService },
          { provide: AppLogger, useValue: appLogger },
        ],
      }).compile();

      const unconfiguredService = module.get<SlackNotificationService>(SlackNotificationService);
      const event = createMockPaymentEvent();
      await unconfiguredService.sendPaymentNotification(event);

      expect(httpService.post).not.toHaveBeenCalled();
    });

    it('should handle HTTP request errors gracefully', async () => {
      const error = new Error('Network error');
      httpService.post.mockReturnValue(throwError(() => error));

      const event = createMockPaymentEvent();
      await expect(service.sendPaymentNotification(event)).resolves.not.toThrow();

      expect(httpService.post).toHaveBeenCalled();
    });

    it('should format payment message with all fields', async () => {
      const event = createMockPaymentEvent({
        amount: 250.75,
        currency: 'EUR',
        status: 'COMPLETED',
        payerName: 'Jane Smith',
        payerEmail: 'jane.smith@example.com',
        description: 'Invoice #INV-2026-001',
      });

      await service.sendPaymentNotification(event);

      const callArgs = httpService.post.mock.calls[0];
      const blocks = callArgs[1].blocks;

      // Should have header, section, and context
      expect(blocks.length).toBeGreaterThanOrEqual(3);
      expect(blocks[0].type).toBe('header');
      expect(blocks[1].type).toBe('section');
      expect(blocks[2].type).toBe('context');
    });

    it('should include all relevant fields in the message', async () => {
      const event = createMockPaymentEvent();
      await service.sendPaymentNotification(event);

      const callArgs = httpService.post.mock.calls[0];
      const blocks = callArgs[1].blocks;
      const section = blocks[1];

      // Verify fields are included
      expect(section.fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ text: expect.stringContaining('pay_123456') }),
          expect.objectContaining({ text: expect.stringContaining('USD') }),
          expect.objectContaining({ text: expect.stringContaining('COMPLETED') }),
          expect.objectContaining({ text: expect.stringContaining('merchant@example.com') }),
          expect.objectContaining({ text: expect.stringContaining('John Doe') }),
          expect.objectContaining({ text: expect.stringContaining('Test payment') }),
        ]),
      );
    });

    it('should exclude optional fields when not provided', async () => {
      const event = createMockPaymentEvent({
        merchantEmail: undefined,
        payerEmail: undefined,
        payerName: undefined,
        description: undefined,
      });

      await service.sendPaymentNotification(event);

      const callArgs = httpService.post.mock.calls[0];
      const blocks = callArgs[1].blocks;
      const section = blocks[1];

      // Should only have paymentId, amount, and status fields
      expect(section.fields.length).toBe(3);
    });

    it('should log when notification is sent', async () => {
      const mockLogger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      };
      appLogger.child.mockReturnValue(mockLogger as any);

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          SlackNotificationService,
          { provide: HttpService, useValue: httpService },
          { provide: ConfigService, useValue: configService },
          { provide: AppLogger, useValue: appLogger },
        ],
      }).compile();

      const loggedService = module.get<SlackNotificationService>(SlackNotificationService);
      const event = createMockPaymentEvent();
      await loggedService.sendPaymentNotification(event);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.objectContaining({ paymentId: event.paymentId }),
        expect.stringContaining('Slack notification sent'),
      );
    });

    it('should log errors when sending fails', async () => {
      const mockLogger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      };
      appLogger.child.mockReturnValue(mockLogger as any);

      const error = new Error('HTTP 500');
      httpService.post.mockReturnValue(throwError(() => error));

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          SlackNotificationService,
          { provide: HttpService, useValue: httpService },
          { provide: ConfigService, useValue: configService },
          { provide: AppLogger, useValue: appLogger },
        ],
      }).compile();

      const loggedService = module.get<SlackNotificationService>(SlackNotificationService);
      const event = createMockPaymentEvent();
      await loggedService.sendPaymentNotification(event);

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ paymentId: event.paymentId }),
        expect.stringContaining('Failed to send Slack notification'),
      );
    });
  });

  describe('sendPaymentCompleted', () => {
    it('should send notification with COMPLETED status', async () => {
      const event = createMockPaymentEvent({ status: 'PENDING' });
      await service.sendPaymentCompleted(event);

      const callArgs = httpService.post.mock.calls[0];
      const blocks = callArgs[1].blocks;
      const section = blocks[1];

      expect(section.fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ text: expect.stringContaining('COMPLETED') }),
        ]),
      );
    });
  });

  describe('sendPaymentFailed', () => {
    it('should send notification with FAILED status', async () => {
      const event = createMockPaymentEvent();
      await service.sendPaymentFailed(event);

      const callArgs = httpService.post.mock.calls[0];
      const blocks = callArgs[1].blocks;
      const section = blocks[1];

      expect(section.fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ text: expect.stringContaining('FAILED') }),
        ]),
      );
    });
  });

  describe('sendPaymentRefunded', () => {
    it('should send notification with REFUNDED status', async () => {
      const event = createMockPaymentEvent();
      await service.sendPaymentRefunded(event);

      const callArgs = httpService.post.mock.calls[0];
      const blocks = callArgs[1].blocks;
      const section = blocks[1];

      expect(section.fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ text: expect.stringContaining('REFUNDED') }),
        ]),
      );
    });
  });

  describe('sendPaymentCancelled', () => {
    it('should send notification with CANCELLED status', async () => {
      const event = createMockPaymentEvent();
      await service.sendPaymentCancelled(event);

      const callArgs = httpService.post.mock.calls[0];
      const blocks = callArgs[1].blocks;
      const section = blocks[1];

      expect(section.fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ text: expect.stringContaining('CANCELLED') }),
        ]),
      );
    });
  });

  describe('formatPaymentMessage', () => {
    it('should use correct emoji for COMPLETED status', async () => {
      const event = createMockPaymentEvent({ status: 'COMPLETED' });
      await service.sendPaymentNotification(event);

      const callArgs = httpService.post.mock.calls[0];
      const blocks = callArgs[1].blocks;
      const section = blocks[1];

      expect(section.fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ text: expect.stringContaining('✅') }),
        ]),
      );
    });

    it('should use correct emoji for FAILED status', async () => {
      const event = createMockPaymentEvent({ status: 'FAILED' });
      await service.sendPaymentNotification(event);

      const callArgs = httpService.post.mock.calls[0];
      const blocks = callArgs[1].blocks;
      const section = blocks[1];

      expect(section.fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ text: expect.stringContaining('❌') }),
        ]),
      );
    });

    it('should use correct emoji for REFUNDED status', async () => {
      const event = createMockPaymentEvent({ status: 'REFUNDED' });
      await service.sendPaymentNotification(event);

      const callArgs = httpService.post.mock.calls[0];
      const blocks = callArgs[1].blocks;
      const section = blocks[1];

      expect(section.fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ text: expect.stringContaining('↩️') }),
        ]),
      );
    });

    it('should format amount with currency', async () => {
      const event = createMockPaymentEvent({
        amount: 1234.56,
        currency: 'GBP',
      });

      await service.sendPaymentNotification(event);

      const callArgs = httpService.post.mock.calls[0];
      const blocks = callArgs[1].blocks;
      const section = blocks[1];

      expect(section.fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ text: expect.stringContaining('GBP 1234.56') }),
        ]),
      );
    });

    it('should handle payer with name and email', async () => {
      const event = createMockPaymentEvent({
        payerName: 'Alice Johnson',
        payerEmail: 'alice@example.com',
      });

      await service.sendPaymentNotification(event);

      const callArgs = httpService.post.mock.calls[0];
      const blocks = callArgs[1].blocks;
      const section = blocks[1];

      expect(section.fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            text: expect.stringContaining('Alice Johnson (alice@example.com)'),
          }),
        ]),
      );
    });

    it('should handle payer with only email', async () => {
      const event = createMockPaymentEvent({
        payerName: undefined,
        payerEmail: 'alice@example.com',
      });

      await service.sendPaymentNotification(event);

      const callArgs = httpService.post.mock.calls[0];
      const blocks = callArgs[1].blocks;
      const section = blocks[1];

      expect(section.fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            text: expect.stringContaining('alice@example.com'),
          }),
        ]),
      );
    });

    it('should include timestamp in context', async () => {
      const timestamp = new Date('2026-06-15T14:30:00Z');
      const event = createMockPaymentEvent({ timestamp });

      await service.sendPaymentNotification(event);

      const callArgs = httpService.post.mock.calls[0];
      const blocks = callArgs[1].blocks;
      const context = blocks[2];

      expect(context.type).toBe('context');
      expect(context.elements[0].text).toContain(timestamp.toISOString());
    });
  });

  describe('edge cases', () => {
    it('should handle very large amounts', async () => {
      const event = createMockPaymentEvent({
        amount: 999999999.99,
        currency: 'USD',
      });

      await service.sendPaymentNotification(event);

      const callArgs = httpService.post.mock.calls[0];
      const blocks = callArgs[1].blocks;
      const section = blocks[1];

      expect(section.fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ text: expect.stringContaining('999999999.99') }),
        ]),
      );
    });

    it('should handle special characters in description', async () => {
      const event = createMockPaymentEvent({
        description: 'Test with special chars: <>&"\'',
      });

      await service.sendPaymentNotification(event);

      const callArgs = httpService.post.mock.calls[0];
      const blocks = callArgs[1].blocks;

      expect(blocks).toBeDefined();
      expect(httpService.post).toHaveBeenCalled();
    });

    it('should handle unknown status with default emoji', async () => {
      const event = createMockPaymentEvent({ status: 'UNKNOWN_STATUS' });

      await service.sendPaymentNotification(event);

      const callArgs = httpService.post.mock.calls[0];
      const blocks = callArgs[1].blocks;
      const section = blocks[1];

      expect(section.fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            text: expect.stringContaining('📋'), // Default emoji
          }),
        ]),
      );
    });
  });
});
