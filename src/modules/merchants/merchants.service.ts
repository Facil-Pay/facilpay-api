import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MerchantGeoRestriction } from './entities/merchant-geo-restriction.entity';
import { MerchantIpAllowlist } from './entities/merchant-ip-allowlist.entity';
import { UpdateGeoRestrictionsDto } from './dto/update-geo-restrictions.dto';
import { UpdateIpAllowlistDto } from './dto/update-ip-allowlist.dto';
import { GeoLookupService } from './geo-lookup.service';
import { GeoRestrictedException } from './geo-restricted.exception';
import { IpAllowlistBlockedException } from './ip-allowlist-blocked.exception';
import { isIpAllowed } from './ip-utils';

@Injectable()
export class MerchantsService {
  constructor(
    @InjectRepository(MerchantGeoRestriction)
    private readonly geoRestrictionRepo: Repository<MerchantGeoRestriction>,
    @InjectRepository(MerchantIpAllowlist)
    private readonly ipAllowlistRepo: Repository<MerchantIpAllowlist>,
    private readonly geoLookupService: GeoLookupService,
  ) {}

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
}
