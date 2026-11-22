import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { OnboardingService } from './onboarding.service';
import { MerchantOnboarding, OnboardingStatus } from './merchant-onboarding.entity';
import { EmailNotificationService } from '../notifications/email-notification.service';
import { BusinessInfoDto } from './dto/business-info.dto';
import { DocumentsDto } from './dto/documents.dto';
import { ReviewOnboardingDto } from './dto/review-onboarding.dto';

describe('OnboardingService', () => {
  let service: OnboardingService;
  let repository: any;
  let emailService: any;

  const createMockOnboarding = (overrides: Partial<MerchantOnboarding> = {}): MerchantOnboarding =>
    ({
      id: 'onboarding-1',
      merchantId: 'merchant-1',
      businessName: 'Test Business',
      businessEmail: 'business@example.com',
      businessAddress: '123 Main St',
      idDocumentUrl: 'https://example.com/id.pdf',
      businessCertificateUrl: 'https://example.com/cert.pdf',
      status: OnboardingStatus.PENDING,
      rejectionReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    } as MerchantOnboarding);

  beforeEach(async () => {
    repository = {
      findOneBy: jest.fn(),
      create: jest.fn((data) => data),
      save: jest.fn(async (entity) => entity),
    };

    emailService = {
      sendMerchantPaymentReceived: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OnboardingService,
        {
          provide: getRepositoryToken(MerchantOnboarding),
          useValue: repository,
        },
        {
          provide: EmailNotificationService,
          useValue: emailService,
        },
      ],
    }).compile();

    service = module.get<OnboardingService>(OnboardingService);
  });

  describe('submitBusinessInfo', () => {
    it('should create new onboarding record if not exists', async () => {
      repository.findOneBy.mockResolvedValue(null);
      const dto: BusinessInfoDto = {
        businessName: 'New Business',
        businessEmail: 'new@example.com',
        businessAddress: '456 Oak Ave',
      };

      await service.submitBusinessInfo('merchant-1', dto);

      expect(repository.create).toHaveBeenCalledWith({ merchantId: 'merchant-1' });
      expect(repository.save).toHaveBeenCalled();
    });

    it('should update existing onboarding record', async () => {
      const existing = createMockOnboarding();
      repository.findOneBy.mockResolvedValue(existing);
      const dto: BusinessInfoDto = {
        businessName: 'Updated Business',
        businessEmail: 'updated@example.com',
        businessAddress: '789 Elm St',
      };

      const result = await service.submitBusinessInfo('merchant-1', dto);

      expect(result.businessName).toBe('Updated Business');
      expect(result.businessEmail).toBe('updated@example.com');
      expect(result.businessAddress).toBe('789 Elm St');
      expect(result.status).toBe(OnboardingStatus.PENDING);
    });

    it('should preserve existing address if not provided', async () => {
      const existing = createMockOnboarding({ businessAddress: 'Old Address' });
      repository.findOneBy.mockResolvedValue(existing);
      const dto: BusinessInfoDto = {
        businessName: 'Updated',
        businessEmail: 'updated@example.com',
      };

      const result = await service.submitBusinessInfo('merchant-1', dto);

      expect(result.businessAddress).toBe('Old Address');
    });

    it('should set status to PENDING', async () => {
      repository.findOneBy.mockResolvedValue(null);
      const dto: BusinessInfoDto = {
        businessName: 'Business',
        businessEmail: 'test@example.com',
      };

      const result = await service.submitBusinessInfo('merchant-1', dto);

      expect(result.status).toBe(OnboardingStatus.PENDING);
    });
  });

  describe('submitDocuments', () => {
    it('should create new onboarding record if not exists', async () => {
      repository.findOneBy.mockResolvedValue(null);
      const dto: DocumentsDto = {
        idDocumentUrl: 'https://example.com/id.pdf',
        businessCertificateUrl: 'https://example.com/cert.pdf',
      };

      await service.submitDocuments('merchant-1', dto);

      expect(repository.create).toHaveBeenCalledWith({ merchantId: 'merchant-1' });
      expect(repository.save).toHaveBeenCalled();
    });

    it('should update existing onboarding record with documents', async () => {
      const existing = createMockOnboarding({
        idDocumentUrl: null,
        businessCertificateUrl: null,
      });
      repository.findOneBy.mockResolvedValue(existing);
      const dto: DocumentsDto = {
        idDocumentUrl: 'https://example.com/new-id.pdf',
        businessCertificateUrl: 'https://example.com/new-cert.pdf',
      };

      const result = await service.submitDocuments('merchant-1', dto);

      expect(result.idDocumentUrl).toBe('https://example.com/new-id.pdf');
      expect(result.businessCertificateUrl).toBe('https://example.com/new-cert.pdf');
      expect(result.status).toBe(OnboardingStatus.PENDING);
    });

    it('should set status to PENDING', async () => {
      repository.findOneBy.mockResolvedValue(null);
      const dto: DocumentsDto = {
        idDocumentUrl: 'https://example.com/id.pdf',
        businessCertificateUrl: 'https://example.com/cert.pdf',
      };

      const result = await service.submitDocuments('merchant-1', dto);

      expect(result.status).toBe(OnboardingStatus.PENDING);
    });

    it('should handle partial document submission', async () => {
      const existing = createMockOnboarding();
      repository.findOneBy.mockResolvedValue(existing);
      const dto: DocumentsDto = {
        idDocumentUrl: 'https://example.com/new-id.pdf',
      };

      const result = await service.submitDocuments('merchant-1', dto);

      expect(result.idDocumentUrl).toBe('https://example.com/new-id.pdf');
      expect(repository.save).toHaveBeenCalled();
    });
  });

  describe('getStatus', () => {
    it('should return existing onboarding record', async () => {
      const existing = createMockOnboarding();
      repository.findOneBy.mockResolvedValue(existing);

      const result = await service.getStatus('merchant-1');

      expect(result).toEqual(existing);
      expect(repository.findOneBy).toHaveBeenCalledWith({ merchantId: 'merchant-1' });
    });

    it('should create new record if not exists', async () => {
      repository.findOneBy.mockResolvedValue(null);

      await service.getStatus('merchant-1');

      expect(repository.create).toHaveBeenCalledWith({ merchantId: 'merchant-1' });
      expect(repository.save).toHaveBeenCalled();
    });

    it('should return newly created record', async () => {
      const newRecord = { merchantId: 'merchant-1' };
      repository.findOneBy.mockResolvedValue(null);
      repository.create.mockReturnValue(newRecord);
      repository.save.mockResolvedValue(newRecord);

      const result = await service.getStatus('merchant-1');

      expect(result).toEqual(newRecord);
    });
  });

  describe('review', () => {
    it('should throw NotFoundException if onboarding not found', async () => {
      repository.findOneBy.mockResolvedValue(null);
      const dto: ReviewOnboardingDto = {
        status: OnboardingStatus.APPROVED,
      };

      await expect(service.review('merchant-1', dto)).rejects.toThrow(NotFoundException);
    });

    it('should update status to APPROVED', async () => {
      const existing = createMockOnboarding();
      repository.findOneBy.mockResolvedValue(existing);
      const dto: ReviewOnboardingDto = {
        status: OnboardingStatus.APPROVED,
      };

      const result = await service.review('merchant-1', dto);

      expect(result.status).toBe(OnboardingStatus.APPROVED);
      expect(result.rejectionReason).toBeNull();
    });

    it('should update status to REJECTED and set rejection reason', async () => {
      const existing = createMockOnboarding();
      repository.findOneBy.mockResolvedValue(existing);
      const dto: ReviewOnboardingDto = {
        status: OnboardingStatus.REJECTED,
        rejectionReason: 'Documents are invalid',
      };

      const result = await service.review('merchant-1', dto);

      expect(result.status).toBe(OnboardingStatus.REJECTED);
      expect(result.rejectionReason).toBe('Documents are invalid');
    });

    it('should set default rejection reason if not provided', async () => {
      const existing = createMockOnboarding();
      repository.findOneBy.mockResolvedValue(existing);
      const dto: ReviewOnboardingDto = {
        status: OnboardingStatus.REJECTED,
      };

      const result = await service.review('merchant-1', dto);

      expect(result.rejectionReason).toBe('Rejected');
    });

    it('should clear rejection reason on APPROVED status', async () => {
      const existing = createMockOnboarding({
        status: OnboardingStatus.REJECTED,
        rejectionReason: 'Previous rejection',
      });
      repository.findOneBy.mockResolvedValue(existing);
      const dto: ReviewOnboardingDto = {
        status: OnboardingStatus.APPROVED,
      };

      const result = await service.review('merchant-1', dto);

      expect(result.rejectionReason).toBeNull();
    });

    it('should send email notification to merchant', async () => {
      const existing = createMockOnboarding({ businessEmail: 'merchant@example.com', businessName: 'Test Biz' });
      repository.findOneBy.mockResolvedValue(existing);
      const dto: ReviewOnboardingDto = {
        status: OnboardingStatus.APPROVED,
      };

      await service.review('merchant-1', dto);

      expect(emailService.sendMerchantPaymentReceived).toHaveBeenCalledWith(
        'merchant@example.com',
        'Test Biz',
        existing.id,
        '0',
        'USD',
        expect.stringContaining('APPROVED'),
      );
    });

    it('should handle email send failure gracefully', async () => {
      const existing = createMockOnboarding({ businessEmail: 'merchant@example.com' });
      repository.findOneBy.mockResolvedValue(existing);
      emailService.sendMerchantPaymentReceived.mockRejectedValueOnce(new Error('Email failed'));
      const dto: ReviewOnboardingDto = {
        status: OnboardingStatus.APPROVED,
      };

      // Should not throw
      const result = await service.review('merchant-1', dto);

      expect(result.status).toBe(OnboardingStatus.APPROVED);
    });

    it('should not send email if merchant email is not set', async () => {
      const existing = createMockOnboarding({ businessEmail: null });
      repository.findOneBy.mockResolvedValue(existing);
      const dto: ReviewOnboardingDto = {
        status: OnboardingStatus.APPROVED,
      };

      await service.review('merchant-1', dto);

      expect(emailService.sendMerchantPaymentReceived).not.toHaveBeenCalled();
    });

    it('should save and return updated onboarding', async () => {
      const existing = createMockOnboarding();
      repository.findOneBy.mockResolvedValue(existing);
      const dto: ReviewOnboardingDto = {
        status: OnboardingStatus.APPROVED,
      };

      const result = await service.review('merchant-1', dto);

      expect(repository.save).toHaveBeenCalled();
      expect(result).toBeDefined();
    });
  });

  describe('edge cases', () => {
    it('should handle multiple status changes correctly', async () => {
      const onboarding = createMockOnboarding({ status: OnboardingStatus.APPROVED });
      repository.findOneBy.mockResolvedValue(onboarding);
      const dto: ReviewOnboardingDto = {
        status: OnboardingStatus.REJECTED,
        rejectionReason: 'Appeal denied',
      };

      const result = await service.review('merchant-1', dto);

      expect(result.status).toBe(OnboardingStatus.REJECTED);
      expect(result.rejectionReason).toBe('Appeal denied');
    });

    it('should preserve other fields during status update', async () => {
      const existing = createMockOnboarding({
        businessName: 'Preserve This',
        businessEmail: 'preserve@example.com',
      });
      repository.findOneBy.mockResolvedValue(existing);
      const dto: ReviewOnboardingDto = {
        status: OnboardingStatus.APPROVED,
      };

      const result = await service.review('merchant-1', dto);

      expect(result.businessName).toBe('Preserve This');
      expect(result.businessEmail).toBe('preserve@example.com');
    });
  });
});
