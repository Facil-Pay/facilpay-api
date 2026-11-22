import { MerchantSettings } from './entities/merchant-settings.entity';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MerchantGeoRestriction } from './entities/merchant-geo-restriction.entity';
import { MerchantIpAllowlist } from './entities/merchant-ip-allowlist.entity';
import { MerchantOnboarding, OnboardingStatus } from '../onboarding/merchant-onboarding.entity';
import { UpdateGeoRestrictionsDto } from './dto/update-geo-restrictions.dto';
import { UpdateIpAllowlistDto } from './dto/update-ip-allowlist.dto';
import { MerchantProfileResponseDto, UpdateMerchantProfileDto } from './dto/merchant-profile.dto';
import { GeoLookupService } from './geo-lookup.service';
import { GeoRestrictedException } from './geo-restricted.exception';
import { IpAllowlistBlockedException } from './ip-allowlist-blocked.exception';
import { isIpAllowed } from './ip-utils';
import { AuditLogsService, RecordAuditLogParams } from '../audit-logs/audit-logs.service';
import { ActorType } from '../audit-logs/audit-log.entity';

@Injectable()
export class MerchantsService {
  private readonly storage: Storage;
  private readonly bucketName: string;
  private readonly logoStoragePath = 'branding/logos';

  constructor(
    @InjectRepository(MerchantGeoRestriction)
    private readonly geoRestrictionRepo: Repository<MerchantGeoRestriction>,
    @InjectRepository(MerchantIpAllowlist)
    private readonly ipAllowlistRepo: Repository<MerchantIpAllowlist>,
    @InjectRepository(MerchantOnboarding)
    private readonly onboardingRepo: Repository<MerchantOnboarding>,
    private readonly geoLookupService: GeoLookupService,
    private readonly auditLogsService: AuditLogsService,
    @InjectRepository(MerchantSettings)
    private readonly settingsRepo: Repository<MerchantSettings>,
  ) {}

  async getSettings(merchantId: string): Promise<MerchantSettings | null> {
    return this.settingsRepo.findOneBy({ merchantId });
  }

  async upsertSettings(merchantId: string, dto: UpdateSettingsDto): Promise<MerchantSettings> {
    const settings = await this.getSettings(merchantId) ?? this.settingsRepo.create({ merchantId });
    if (dto.idleSessionTimeoutMinutes !== undefined) settings.idleSessionTimeoutMinutes = dto.idleSessionTimeoutMinutes;
    if (dto.remindersEnabled !== undefined) settings.remindersEnabled = dto.remindersEnabled;
    if (dto.muxedAccountsEnabled !== undefined) settings.muxedAccountsEnabled = dto.muxedAccountsEnabled;
    if (dto.reminderOffsets !== undefined) settings.reminderOffsets = dto.reminderOffsets;
    if (dto.timezone !== undefined) settings.timezone = dto.timezone;
    if (dto.refundApprovalThresholds !== undefined) settings.refundApprovalThresholds = dto.refundApprovalThresholds;
    return this.settingsRepo.save(settings);
  }

  async upsertGeoRestrictions(
    merchantId: string,
    dto: UpdateGeoRestrictionsDto,
  ): Promise<MerchantGeoRestriction> {
    let config = await this.geoRestrictionRepo.findOneBy({ merchantId });
    if (!config) {
      config = this.geoRestrictionRepo.create({ merchantId });
    }

    if (dto.allowedCountries !== undefined) {
      config.allowedCountries = dto.allowedCountries;
    }
    if (dto.blockedCountries !== undefined) {
      config.blockedCountries = dto.blockedCountries;
    }
    if (dto.bypassInTestMode !== undefined) {
      config.bypassInTestMode = dto.bypassInTestMode;
    }

    return this.geoRestrictionRepo.save(config);
  }

  /**
   * Enforces a merchant's geo-restriction config for an incoming payment.
   * No-ops when the merchant has no config or the country cannot be resolved.
   */
  async enforceGeoRestriction(
    merchantId: string | undefined,
    ip: string | undefined,
    isTestMode: boolean,
  ): Promise<void> {
    if (!merchantId || !ip) return;

    const config = await this.geoRestrictionRepo.findOneBy({ merchantId });
    if (!config) return;

    if (isTestMode && config.bypassInTestMode) return;

    const country = this.geoLookupService.lookupCountry(ip);
    if (!country) return;

    const { allowedCountries, blockedCountries } = config;

    if (allowedCountries?.length && !allowedCountries.includes(country)) {
      throw new GeoRestrictedException(
        `Payments from ${country} are not permitted by this merchant`,
      );
    }

    if (blockedCountries?.length && blockedCountries.includes(country)) {
      throw new GeoRestrictedException(
        `Payments from ${country} are not permitted by this merchant`,
      );
    }
  }

  /**
   * Upserts the IP allowlist for a merchant.
   * An empty allowedIps array clears all restrictions.
   */
  async upsertIpAllowlist(
    merchantId: string,
    dto: UpdateIpAllowlistDto,
  ): Promise<MerchantIpAllowlist> {
    let record = await this.ipAllowlistRepo.findOneBy({ merchantId });
    if (!record) {
      record = this.ipAllowlistRepo.create({ merchantId, allowedIps: [] });
    }
    record.allowedIps = dto.allowedIps;
    return this.ipAllowlistRepo.save(record);
  }

  /**
   * Returns the current IP allowlist for a merchant.
   */
  async getIpAllowlist(merchantId: string): Promise<MerchantIpAllowlist | null> {
    return this.ipAllowlistRepo.findOneBy({ merchantId });
  }

  /**
   * Enforces the IP allowlist for a merchant API request.
   * No-ops when the merchant has no allowlist config or the list is empty.
   * Throws IpAllowlistBlockedException (403) when the IP is not allowed.
   */
  async enforceIpAllowlist(
    merchantId: string,
    ip: string | undefined,
  ): Promise<void> {
    if (!ip) return;

    const record = await this.ipAllowlistRepo.findOneBy({ merchantId });
    if (!record || !record.allowedIps?.length) return;

    if (!isIpAllowed(ip, record.allowedIps)) {
      throw new IpAllowlistBlockedException(ip);
    }
  }

  /**
   * Get the merchant's profile information
   */
  async getProfile(merchantId: string): Promise<MerchantProfileResponseDto> {
    let onboarding = await this.onboardingRepo.findOneBy({ merchantId });
    
    // Create default onboarding record if none exists
    if (!onboarding) {
      onboarding = await this.onboardingRepo.save(
        this.onboardingRepo.create({ merchantId, status: OnboardingStatus.PENDING }),
      );
    }

    return {
      merchantId: onboarding.merchantId,
      businessName: onboarding.businessName,
      legalName: onboarding.legalName,
      website: onboarding.website,
      supportEmail: onboarding.supportEmail,
      supportPhone: onboarding.supportPhone,
      country: onboarding.country,
      timezone: onboarding.timezone,
      defaultCurrency: onboarding.defaultCurrency,
      status: onboarding.status,
      requiresReReview: onboarding.requiresReReview,
    };
  }

  /**
   * Update the merchant's profile information
   * Changes to legalName or country trigger re-review
   */
  async updateProfile(
    merchantId: string,
    dto: UpdateMerchantProfileDto,
    actorId?: string,
  ): Promise<MerchantProfileResponseDto> {
    let onboarding = await this.onboardingRepo.findOneBy({ merchantId });
    
    if (!onboarding) {
      onboarding = this.onboardingRepo.create({ merchantId, status: OnboardingStatus.PENDING });
    }

    // Track changes for audit log
    const changes: Record<string, { old: string; new: string }> = {};
    const sensitiveFields = ['legalName', 'country'];
    let requiresReReview = false;

    // Apply updates
    if (dto.businessName !== undefined) {
      if (onboarding.businessName !== dto.businessName) {
        changes['businessName'] = { old: onboarding.businessName || '', new: dto.businessName };
        onboarding.businessName = dto.businessName;
      }
    }
    if (dto.legalName !== undefined) {
      if (onboarding.legalName !== dto.legalName) {
        changes['legalName'] = { old: onboarding.legalName || '', new: dto.legalName };
        onboarding.legalName = dto.legalName;
        requiresReReview = true;
      }
    }
    if (dto.website !== undefined) {
      if (onboarding.website !== dto.website) {
        changes['website'] = { old: onboarding.website || '', new: dto.website };
        onboarding.website = dto.website;
      }
    }
    if (dto.supportEmail !== undefined) {
      if (onboarding.supportEmail !== dto.supportEmail) {
        changes['supportEmail'] = { old: onboarding.supportEmail || '', new: dto.supportEmail };
        onboarding.supportEmail = dto.supportEmail;
      }
    }
    if (dto.supportPhone !== undefined) {
      if (onboarding.supportPhone !== dto.supportPhone) {
        changes['supportPhone'] = { old: onboarding.supportPhone || '', new: dto.supportPhone };
        onboarding.supportPhone = dto.supportPhone;
      }
    }
    if (dto.country !== undefined) {
      if (onboarding.country !== dto.country) {
        changes['country'] = { old: onboarding.country || '', new: dto.country };
        onboarding.country = dto.country;
        requiresReReview = true;
      }
    }
    if (dto.timezone !== undefined) {
      if (onboarding.timezone !== dto.timezone) {
        changes['timezone'] = { old: onboarding.timezone || '', new: dto.timezone };
        onboarding.timezone = dto.timezone;
      }
    }
    if (dto.defaultCurrency !== undefined) {
      if (onboarding.defaultCurrency !== dto.defaultCurrency) {
        changes['defaultCurrency'] = { old: onboarding.defaultCurrency || '', new: dto.defaultCurrency };
        onboarding.defaultCurrency = dto.defaultCurrency;
      }
    }

    // Set re-review flag if sensitive fields changed
    if (requiresReReview) {
      onboarding.requiresReReview = true;
      // Also set status to under_review if previously approved
      if (onboarding.status === OnboardingStatus.APPROVED) {
        onboarding.status = OnboardingStatus.UNDER_REVIEW;
      }
    }

    const saved = await this.onboardingRepo.save(onboarding);

    // Record audit log for profile changes
    if (Object.keys(changes).length > 0) {
      const auditParams: RecordAuditLogParams = {
        actorId,
        actorType: ActorType.MERCHANT,
        action: 'merchant_profile_updated',
        resourceType: 'merchant_profile',
        resourceId: merchantId,
        metadata: { changes, requiresReReview },
      };
      await this.auditLogsService.record(auditParams);
    }

    return {
      merchantId: saved.merchantId,
      businessName: saved.businessName,
      legalName: saved.legalName,
      website: saved.website,
      supportEmail: saved.supportEmail,
      supportPhone: saved.supportPhone,
      country: saved.country,
      timezone: saved.timezone,
      defaultCurrency: saved.defaultCurrency,
      status: saved.status,
      requiresReReview: saved.requiresReReview,
    };
  }
}
