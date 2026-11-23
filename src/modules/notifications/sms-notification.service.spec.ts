import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SmsNotificationService } from './sms-notification.service';
import { PhoneVerification } from './phone-verification.entity';
import { NotificationPreferencesService } from './notification-preferences.service';
import { MockSmsProvider } from './providers/mock-sms.provider';
import { NotificationCategory } from './notification-preference.entity';

describe('SmsNotificationService', () => {
  let service: SmsNotificationService;
  let phoneVerificationRepo: Repository<PhoneVerification>;
  let mockSmsProvider: MockSmsProvider;
  let notificationPreferencesService: NotificationPreferencesService;

  beforeEach(async () => {
    mockSmsProvider = new MockSmsProvider();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SmsNotificationService,
        {
          provide: getRepositoryToken(PhoneVerification),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            delete: jest.fn(),
          },
        },
        {
          provide: 'SMS_PROVIDER',
          useValue: mockSmsProvider,
        },
        {
          provide: NotificationPreferencesService,
          useValue: {
            getPreferences: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<SmsNotificationService>(SmsNotificationService);
    phoneVerificationRepo = module.get<Repository<PhoneVerification>>(
      getRepositoryToken(PhoneVerification),
    );
    notificationPreferencesService = module.get<NotificationPreferencesService>(
      NotificationPreferencesService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('sendVerificationCode', () => {
    it('should send verification code to new phone number', async () => {
      const userId = 'user-123';
      const phoneNumber = '+1234567890';

      jest.spyOn(phoneVerificationRepo, 'findOne').mockResolvedValue(null);
      jest.spyOn(phoneVerificationRepo, 'create').mockReturnValue({
        userId,
        phoneNumber,
        verificationCode: '123456',
        verified: false,
      } as any);
      jest.spyOn(phoneVerificationRepo, 'save').mockResolvedValue({} as any);
      jest.spyOn(mockSmsProvider, 'sendVerificationCode').mockResolvedValue('msg-123');

      await service.sendVerificationCode(userId, phoneNumber);

      expect(phoneVerificationRepo.create).toHaveBeenCalled();
      expect(phoneVerificationRepo.save).toHaveBeenCalled();
      expect(mockSmsProvider.sendVerificationCode).toHaveBeenCalledWith(
        phoneNumber,
        expect.any(String),
      );
    });
  });

  describe('verifyPhoneNumber', () => {
    it('should verify phone number with correct code', async () => {
      const userId = 'user-123';
      const phoneNumber = '+1234567890';
      const code = '123456';

      const verification = {
        userId,
        phoneNumber,
        verificationCode: code,
        codeExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
        verified: false,
        verificationAttempts: 0,
      };

      jest.spyOn(phoneVerificationRepo, 'findOne').mockResolvedValue(verification as any);
      jest.spyOn(phoneVerificationRepo, 'save').mockResolvedValue({ ...verification, verified: true } as any);

      const result = await service.verifyPhoneNumber(userId, phoneNumber, code);

      expect(result).toBe(true);
      expect(phoneVerificationRepo.save).toHaveBeenCalled();
    });

    it('should throw error for invalid code', async () => {
      const userId = 'user-123';
      const phoneNumber = '+1234567890';
      const code = '999999';

      const verification = {
        userId,
        phoneNumber,
        verificationCode: '123456',
        codeExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
        verified: false,
        verificationAttempts: 0,
      };

      jest.spyOn(phoneVerificationRepo, 'findOne').mockResolvedValue(verification as any);
      jest.spyOn(phoneVerificationRepo, 'save').mockResolvedValue(verification as any);

      await expect(
        service.verifyPhoneNumber(userId, phoneNumber, code),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw error for expired code', async () => {
      const userId = 'user-123';
      const phoneNumber = '+1234567890';
      const code = '123456';

      const verification = {
        userId,
        phoneNumber,
        verificationCode: code,
        codeExpiresAt: new Date(Date.now() - 1000), // Expired
        verified: false,
        verificationAttempts: 0,
      };

      jest.spyOn(phoneVerificationRepo, 'findOne').mockResolvedValue(verification as any);

      await expect(
        service.verifyPhoneNumber(userId, phoneNumber, code),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw error when no verification found', async () => {
      jest.spyOn(phoneVerificationRepo, 'findOne').mockResolvedValue(null);

      await expect(
        service.verifyPhoneNumber('user-123', '+1234567890', '123456'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('sendPaymentReceived', () => {
    it('should send SMS when phone is verified and preference enabled', async () => {
      const userId = 'user-123';
      const phoneNumber = '+1234567890';

      jest.spyOn(phoneVerificationRepo, 'findOne').mockResolvedValue({
        phoneNumber,
        verified: true,
      } as any);
      jest.spyOn(notificationPreferencesService, 'getPreferences').mockResolvedValue([
        { category: NotificationCategory.PAYMENTS, email: true } as any,
      ]);
      jest.spyOn(mockSmsProvider, 'sendSms').mockResolvedValue('msg-123');

      await service.sendPaymentReceived(userId, '100.00', 'USD');

      expect(mockSmsProvider.sendSms).toHaveBeenCalledWith(
        phoneNumber,
        expect.stringContaining('Payment received'),
      );
    });

    it('should not send SMS when phone not verified', async () => {
      jest.spyOn(phoneVerificationRepo, 'findOne').mockResolvedValue(null);
      jest.spyOn(mockSmsProvider, 'sendSms');

      await service.sendPaymentReceived('user-123', '100.00', 'USD');

      expect(mockSmsProvider.sendSms).not.toHaveBeenCalled();
    });
  });
});
