jest.mock('../../tracing', () => ({
  getTraceId: jest.fn(),
  initializeTracing: jest.fn(),
  runWithTrace: (_name: string, fn: () => unknown) => fn(),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { of } from 'rxjs';
import * as crypto from 'crypto';
import {
  SmsNotificationService,
  SmsProvider,
  SmsMessage,
  SmsSendResult,
  SMS_PROVIDER,
  TwilioSmsProvider,
} from './sms-notification.service';
import { VerifiedPhoneNumber } from './verified-phone-number.entity';
import { NotificationPreferencesService } from './notification-preferences.service';
import { NotificationCategory } from './notification-preference.entity';
import { AppLogger } from '../logger/logger.service';

class MockSmsProvider implements SmsProvider {
  readonly name = 'mock-sms';
  readonly sentMessages: SmsMessage[] = [];

  async sendSms(message: SmsMessage): Promise<SmsSendResult> {
    this.sentMessages.push(message);
    return {
      messageId: `mock-${this.sentMessages.length}`,
      provider: this.name,
      status: 'sent',
    };
  }
}

describe('SmsNotificationService (#553)', () => {
  let service: SmsNotificationService;
  let mockProvider: MockSmsProvider;
  let phoneRepo: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let prefsService: {
    isSmsEnabled: jest.Mock;
  };

  beforeEach(async () => {
    mockProvider = new MockSmsProvider();
    phoneRepo = {
      findOne: jest.fn(),
      create: jest.fn((data) => ({ ...data })),
      save: jest.fn(async (record) => record),
    };
    prefsService = {
      isSmsEnabled: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SmsNotificationService,
        {
          provide: SMS_PROVIDER,
          useValue: mockProvider,
        },
        {
          provide: getRepositoryToken(VerifiedPhoneNumber),
          useValue: phoneRepo,
        },
        {
          provide: NotificationPreferencesService,
          useValue: prefsService,
        },
        {
          provide: AppLogger,
          useValue: {
            child: () => ({
              info: jest.fn(),
              warn: jest.fn(),
              error: jest.fn(),
              debug: jest.fn(),
            }),
          },
        },
      ],
    }).compile();

    service = module.get(SmsNotificationService);
  });

  describe('Phone verification via OTP', () => {
    it('rejects non-E.164 phone numbers', async () => {
      await expect(
        service.requestPhoneVerification('user-1', '415-555-2671'),
      ).rejects.toThrow(BadRequestException);
      expect(mockProvider.sentMessages).toHaveLength(0);
    });

    it('generates an OTP, stores its SHA-256 hash, and sends SMS via the provider', async () => {
      phoneRepo.findOne.mockResolvedValue(null);

      const { expiresAt } = await service.requestPhoneVerification(
        'user-1',
        '+14155552671',
      );

      expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(phoneRepo.save).toHaveBeenCalledTimes(1);
      const saved = phoneRepo.save.mock.calls[0][0] as VerifiedPhoneNumber;
      expect(saved.userId).toBe('user-1');
      expect(saved.phoneNumber).toBe('+14155552671');
      expect(saved.verified).toBe(false);
      expect(saved.otpCodeHash).toMatch(/^[a-f0-9]{64}$/);

      expect(mockProvider.sentMessages).toHaveLength(1);
      expect(mockProvider.sentMessages[0].to).toBe('+14155552671');
      expect(mockProvider.sentMessages[0].body).toMatch(/\b\d{6}\b/);
    });

    it('verifies valid OTP and marks phone number as verified', async () => {
      const code = '482910';
      const hash = crypto.createHash('sha256').update(code).digest('hex');
      const record: Partial<VerifiedPhoneNumber> = {
        userId: 'user-1',
        phoneNumber: '+14155552671',
        verified: false,
        otpCodeHash: hash,
        otpExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
        attempts: 0,
      };
      phoneRepo.findOne.mockResolvedValue(record);

      const verified = await service.verifyPhoneOtp('user-1', code);

      expect(verified.verified).toBe(true);
      expect(verified.verifiedAt).toBeInstanceOf(Date);
      expect(verified.otpCodeHash).toBeNull();
      expect(verified.otpExpiresAt).toBeNull();
    });

    it('increments attempts and throws on invalid OTP', async () => {
      const hash = crypto.createHash('sha256').update('111111').digest('hex');
      const record: Partial<VerifiedPhoneNumber> = {
        userId: 'user-1',
        phoneNumber: '+14155552671',
        verified: false,
        otpCodeHash: hash,
        otpExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
        attempts: 1,
      };
      phoneRepo.findOne.mockResolvedValue(record);

      await expect(service.verifyPhoneOtp('user-1', '999999')).rejects.toThrow(
        BadRequestException,
      );
      expect(record.attempts).toBe(2);
      expect(phoneRepo.save).toHaveBeenCalledWith(record);
    });

    it('rejects expired OTP codes', async () => {
      const code = '123456';
      const hash = crypto.createHash('sha256').update(code).digest('hex');
      phoneRepo.findOne.mockResolvedValue({
        userId: 'user-1',
        phoneNumber: '+14155552671',
        verified: false,
        otpCodeHash: hash,
        otpExpiresAt: new Date(Date.now() - 1000),
        attempts: 0,
      });

      await expect(service.verifyPhoneOtp('user-1', code)).rejects.toThrow(
        'Verification code has expired',
      );
    });
  });

  describe('Event notifications & preference enforcement', () => {
    it('sends payment-received SMS when preferences are enabled and phone is verified', async () => {
      prefsService.isSmsEnabled.mockResolvedValue(true);
      phoneRepo.findOne.mockResolvedValue({
        userId: 'user-1',
        phoneNumber: '+14155552671',
        verified: true,
      });

      const result = await service.sendPaymentReceivedSms({
        userId: 'user-1',
        paymentId: 'pay_123',
        amount: 49.99,
        currency: 'USDC',
      });

      expect(result).toEqual({
        messageId: 'mock-1',
        provider: 'mock-sms',
        status: 'sent',
      });
      expect(prefsService.isSmsEnabled).toHaveBeenCalledWith(
        'user-1',
        NotificationCategory.PAYMENTS,
      );
      expect(mockProvider.sentMessages).toHaveLength(1);
      expect(mockProvider.sentMessages[0].body).toContain('pay_123');
      expect(mockProvider.sentMessages[0].body).toContain('49.99 USDC');
    });

    it('skips payment-received SMS when SMS preference for PAYMENTS is disabled', async () => {
      prefsService.isSmsEnabled.mockResolvedValue(false);

      const result = await service.sendPaymentReceivedSms({
        userId: 'user-1',
        paymentId: 'pay_123',
        amount: 49.99,
        currency: 'USDC',
      });

      expect(result).toBeNull();
      expect(mockProvider.sentMessages).toHaveLength(0);
    });

    it('skips payout-completed SMS when phone is not verified', async () => {
      prefsService.isSmsEnabled.mockResolvedValue(true);
      phoneRepo.findOne.mockResolvedValue(null);

      const result = await service.sendPayoutCompletedSms({
        userId: 'user-1',
        payoutId: 'po_456',
        amount: '250.00',
        asset: 'USDC',
      });

      expect(result).toBeNull();
      expect(mockProvider.sentMessages).toHaveLength(0);
    });

    it('sends payout-completed SMS when preferences are enabled and phone is verified', async () => {
      prefsService.isSmsEnabled.mockResolvedValue(true);
      phoneRepo.findOne.mockResolvedValue({
        userId: 'user-1',
        phoneNumber: '+14155552671',
        verified: true,
      });

      const result = await service.sendPayoutCompletedSms({
        userId: 'user-1',
        payoutId: 'po_456',
        amount: '250.00',
        asset: 'USDC',
      });

      expect(result?.provider).toBe('mock-sms');
      expect(prefsService.isSmsEnabled).toHaveBeenCalledWith(
        'user-1',
        NotificationCategory.SETTLEMENTS,
      );
      expect(mockProvider.sentMessages[0].body).toContain('po_456');
      expect(mockProvider.sentMessages[0].body).toContain('250.00 USDC');
    });
  });

  describe('TwilioSmsProvider adapter', () => {
    it('posts URL-encoded message to Twilio Messages API with Basic Auth', async () => {
      const httpService = {
        post: jest.fn().mockReturnValue(
          of({
            data: { sid: 'SM1234567890', status: 'queued' },
          }),
        ),
      } as unknown as HttpService;

      const configService = {
        get: jest.fn((key: string, defaultVal = '') => {
          const map: Record<string, string> = {
            TWILIO_ACCOUNT_SID: 'AC_test_sid',
            TWILIO_AUTH_TOKEN: 'secret_token',
            TWILIO_FROM_NUMBER: '+15005550006',
          };
          return map[key] ?? defaultVal;
        }),
      } as unknown as ConfigService;

      const twilio = new TwilioSmsProvider(httpService, configService);
      const res = await twilio.sendSms({
        to: '+14155552671',
        body: 'Test Twilio SMS',
      });

      expect(res).toEqual({
        messageId: 'SM1234567890',
        provider: 'twilio',
        status: 'queued',
      });
      expect(httpService.post).toHaveBeenCalledWith(
        'https://api.twilio.com/2010-04-01/Accounts/AC_test_sid/Messages.json',
        expect.stringContaining('To=%2B14155552671'),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/x-www-form-urlencoded',
          }),
        }),
      );
    });
  });
});
