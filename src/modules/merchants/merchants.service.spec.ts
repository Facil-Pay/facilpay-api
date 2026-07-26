import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MerchantsService } from './merchants.service';
import { MerchantGeoRestriction } from './entities/merchant-geo-restriction.entity';
import { GeoLookupService } from './geo-lookup.service';
import { GeoRestrictedException } from './geo-restricted.exception';

describe('MerchantsService', () => {
  let service: MerchantsService;
  let mockRepo: { findOneBy: jest.Mock; create: jest.Mock; save: jest.Mock };
  let mockGeoLookupService: { lookupCountry: jest.Mock };

  beforeEach(async () => {
    mockRepo = {
      findOneBy: jest.fn(),
      create: jest.fn((v) => v),
      save: jest.fn((v) => Promise.resolve(v)),
    };
    mockGeoLookupService = { lookupCountry: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MerchantsService,
        { provide: getRepositoryToken(MerchantGeoRestriction), useValue: mockRepo },
        { provide: GeoLookupService, useValue: mockGeoLookupService },
      ],
    }).compile();

    service = module.get<MerchantsService>(MerchantsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('upsertGeoRestrictions', () => {
    it('should create a new config when none exists', async () => {
      mockRepo.findOneBy.mockResolvedValue(null);

      const result = await service.upsertGeoRestrictions('merchant-1', {
        allowedCountries: ['US'],
      });

      expect(mockRepo.create).toHaveBeenCalledWith({ merchantId: 'merchant-1' });
      expect(result.allowedCountries).toEqual(['US']);
    });

    it('should update an existing config', async () => {
      mockRepo.findOneBy.mockResolvedValue({
        merchantId: 'merchant-1',
        allowedCountries: null,
        blockedCountries: null,
        bypassInTestMode: true,
      });

      const result = await service.upsertGeoRestrictions('merchant-1', {
        blockedCountries: ['KP'],
        bypassInTestMode: false,
      });

      expect(result.blockedCountries).toEqual(['KP']);
      expect(result.bypassInTestMode).toBe(false);
    });
  });

  describe('enforceGeoRestriction', () => {
    it('should allow when no merchantId is provided', async () => {
      await expect(
        service.enforceGeoRestriction(undefined, '1.2.3.4', false),
      ).resolves.toBeUndefined();
      expect(mockRepo.findOneBy).not.toHaveBeenCalled();
    });

    it('should allow when the merchant has no geo-restriction config', async () => {
      mockRepo.findOneBy.mockResolvedValue(null);

      await expect(
        service.enforceGeoRestriction('merchant-1', '1.2.3.4', false),
      ).resolves.toBeUndefined();
    });

    it('should bypass the check in test mode when bypassInTestMode is enabled', async () => {
      mockRepo.findOneBy.mockResolvedValue({
        allowedCountries: ['US'],
        blockedCountries: null,
        bypassInTestMode: true,
      });

      await expect(
        service.enforceGeoRestriction('merchant-1', '1.2.3.4', true),
      ).resolves.toBeUndefined();
      expect(mockGeoLookupService.lookupCountry).not.toHaveBeenCalled();
    });

    it('should throw GeoRestrictedException when the country is not in the allow list', async () => {
      mockRepo.findOneBy.mockResolvedValue({
        allowedCountries: ['US', 'GB'],
        blockedCountries: null,
        bypassInTestMode: true,
      });
      mockGeoLookupService.lookupCountry.mockReturnValue('KP');

      await expect(
        service.enforceGeoRestriction('merchant-1', '1.2.3.4', false),
      ).rejects.toThrow(GeoRestrictedException);
    });

    it('should throw GeoRestrictedException when the country is in the block list', async () => {
      mockRepo.findOneBy.mockResolvedValue({
        allowedCountries: null,
        blockedCountries: ['KP'],
        bypassInTestMode: true,
      });
      mockGeoLookupService.lookupCountry.mockReturnValue('KP');

      await expect(
        service.enforceGeoRestriction('merchant-1', '1.2.3.4', false),
      ).rejects.toThrow(GeoRestrictedException);
    });

    it('should allow when the country cannot be resolved', async () => {
      mockRepo.findOneBy.mockResolvedValue({
        allowedCountries: ['US'],
        blockedCountries: null,
        bypassInTestMode: true,
      });
      mockGeoLookupService.lookupCountry.mockReturnValue(null);

      await expect(
        service.enforceGeoRestriction('merchant-1', '1.2.3.4', false),
      ).resolves.toBeUndefined();
    });

    it('should allow when the country is permitted', async () => {
      mockRepo.findOneBy.mockResolvedValue({
        allowedCountries: ['US'],
        blockedCountries: null,
        bypassInTestMode: true,
      });
      mockGeoLookupService.lookupCountry.mockReturnValue('US');

      await expect(
        service.enforceGeoRestriction('merchant-1', '1.2.3.4', false),
      ).resolves.toBeUndefined();
    });
  });
});
