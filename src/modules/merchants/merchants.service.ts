import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MerchantGeoRestriction } from './entities/merchant-geo-restriction.entity';
import { UpdateGeoRestrictionsDto } from './dto/update-geo-restrictions.dto';
import { GeoLookupService } from './geo-lookup.service';
import { GeoRestrictedException } from './geo-restricted.exception';

@Injectable()
export class MerchantsService {
  constructor(
    @InjectRepository(MerchantGeoRestriction)
    private readonly geoRestrictionRepo: Repository<MerchantGeoRestriction>,
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
}
