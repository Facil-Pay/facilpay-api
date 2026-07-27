import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  MerchantOnboarding,
  OnboardingStatus,
} from './merchant-onboarding.entity';
import { BusinessInfoDto } from './dto/business-info.dto';
import { DocumentsDto } from './dto/documents.dto';
import { ReviewOnboardingDto } from './dto/review-onboarding.dto';
import { EmailNotificationService } from '../notifications/email-notification.service';

@Injectable()
export class OnboardingService {
  constructor(
    @InjectRepository(MerchantOnboarding)
    private readonly repo: Repository<MerchantOnboarding>,
    private readonly emailNotificationService: EmailNotificationService,
  ) {}

  async submitBusinessInfo(
    merchantId: string,
    dto: BusinessInfoDto,
  ): Promise<MerchantOnboarding> {
    let onboarding = await this.repo.findOneBy({ merchantId });
    if (!onboarding) {
      onboarding = this.repo.create({ merchantId });
    }
    onboarding.businessName = dto.businessName;
    onboarding.businessEmail = dto.businessEmail;
    onboarding.businessAddress =
      dto.businessAddress ?? onboarding.businessAddress;
    onboarding.status = OnboardingStatus.PENDING;
    return this.repo.save(onboarding);
  }

  async submitDocuments(
    merchantId: string,
    dto: DocumentsDto,
  ): Promise<MerchantOnboarding> {
    let onboarding = await this.repo.findOneBy({ merchantId });
    if (!onboarding) {
      onboarding = this.repo.create({ merchantId });
    }
    onboarding.idDocumentUrl = dto.idDocumentUrl;
    onboarding.businessCertificateUrl = dto.businessCertificateUrl;
    onboarding.status = OnboardingStatus.PENDING;
    return this.repo.save(onboarding);
  }

  async getStatus(merchantId: string): Promise<MerchantOnboarding> {
    const onboarding = await this.repo.findOneBy({ merchantId });
    if (!onboarding) {
      return this.repo.save(this.repo.create({ merchantId }));
    }
    return onboarding;
  }

  async review(
    merchantId: string,
    dto: ReviewOnboardingDto,
  ): Promise<MerchantOnboarding> {
    const onboarding = await this.repo.findOneBy({ merchantId });
    if (!onboarding) {
      throw new NotFoundException('Onboarding record not found');
    }
    onboarding.status = dto.status;
    onboarding.rejectionReason =
      dto.status === OnboardingStatus.REJECTED
        ? (dto.rejectionReason ?? 'Rejected')
        : null;
    const saved = await this.repo.save(onboarding);
    if (onboarding.businessEmail) {
      await this.emailNotificationService
        .sendMerchantPaymentReceived(
          onboarding.businessEmail,
          onboarding.businessName,
          saved.id,
          '0',
          'USD',
          `Onboarding status updated to ${saved.status}`,
        )
        .catch(() => undefined);
    }
    return saved;
  }
}
