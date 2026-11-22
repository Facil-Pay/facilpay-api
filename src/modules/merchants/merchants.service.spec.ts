import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MerchantSettings } from './entities/merchant-settings.entity';
import { MerchantOnboarding } from '../onboarding/merchant-onboarding.entity';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { MerchantsService } from './merchants.service';
import { MerchantGeoRestriction } from './entities/merchant-geo-restriction.entity';
import { MerchantIpAllowlist } from './entities/merchant-ip-allowlist.entity';
import { GeoLookupService } from './geo-lookup.service';
import { GeoRestrictedException } from './geo-restricted.exception';
import { IpAllowlistBlockedException } from './ip-allowlist-blocked.exception';
import { extractClientIp } from './ip-utils';

describe('MerchantsService', () => {
  let service: MerchantsService;
  let mockRepo: { findOneBy: jest.Mock; create: jest.Mock; save: jest.Mock };
  let mockIpAllowlistRepo: { findOneBy: jest.Mock; create: jest.Mock; save: jest.Mock };
  let mockGeoLookupService: { lookupCountry: jest.Mock };

  beforeEach(async () => {
    mockRepo = {
      findOneBy: jest.fn(),
      create: jest.fn((v) => ({ ...v })),
      save: jest.fn((v) => Promise.resolve(v)),
    };
    mockIpAllowlistRepo = {
      findOneBy: jest.fn(),
      create: jest.fn((v) => ({ ...v })),
      save: jest.fn((v) => Promise.resolve(v)),
    };
    mockGeoLookupService = { lookupCountry: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MerchantsService,
        { provide: getRepositoryToken(MerchantSettings), useValue: { findOneBy: jest.fn(), create: jest.fn(value => ({ ...value })), save: jest.fn(value => Promise.resolve(value)) } },
        { provide: getRepositoryToken(MerchantOnboarding), useValue: {} },
        { provide: AuditLogsService, useValue: { record: jest.fn() } },
        { provide: getRepositoryToken(MerchantGeoRestriction), useValue: mockRepo },
        { provide: getRepositoryToken(MerchantIpAllowlist), useValue: mockIpAllowlistRepo },
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

  describe('upsertIpAllowlist', () => {
    it('creates a new record when none exists', async () => {
      mockIpAllowlistRepo.findOneBy.mockResolvedValue(null);

      const result = await service.upsertIpAllowlist('merchant-1', {
        allowedIps: ['1.2.3.4', '10.0.0.0/8'],
      });

      expect(mockIpAllowlistRepo.create).toHaveBeenCalledWith({
        merchantId: 'merchant-1',
        allowedIps: [],
      });
      expect(result.allowedIps).toEqual(['1.2.3.4', '10.0.0.0/8']);
    });

    it('updates an existing record', async () => {
      mockIpAllowlistRepo.findOneBy.mockResolvedValue({
        merchantId: 'merchant-1',
        allowedIps: ['5.5.5.5'],
      });

      const result = await service.upsertIpAllowlist('merchant-1', {
        allowedIps: ['9.9.9.9'],
      });

      expect(result.allowedIps).toEqual(['9.9.9.9']);
    });

    it('clears restrictions when allowedIps is empty', async () => {
      mockIpAllowlistRepo.findOneBy.mockResolvedValue({
        merchantId: 'merchant-1',
        allowedIps: ['1.2.3.4'],
      });

      const result = await service.upsertIpAllowlist('merchant-1', { allowedIps: [] });

      expect(result.allowedIps).toEqual([]);
    });
  });

  describe('enforceIpAllowlist', () => {
    it('allows when no record exists (no restriction)', async () => {
      mockIpAllowlistRepo.findOneBy.mockResolvedValue(null);

      await expect(
        service.enforceIpAllowlist('merchant-1', '1.2.3.4'),
      ).resolves.toBeUndefined();
    });

    it('allows when allowedIps is empty (no restriction)', async () => {
      mockIpAllowlistRepo.findOneBy.mockResolvedValue({
        merchantId: 'merchant-1',
        allowedIps: [],
      });

      await expect(
        service.enforceIpAllowlist('merchant-1', '1.2.3.4'),
      ).resolves.toBeUndefined();
    });

    it('allows when ip is undefined', async () => {
      await expect(
        service.enforceIpAllowlist('merchant-1', undefined),
      ).resolves.toBeUndefined();
      expect(mockIpAllowlistRepo.findOneBy).not.toHaveBeenCalled();
    });

    it('allows when IP is in the exact allowlist', async () => {
      mockIpAllowlistRepo.findOneBy.mockResolvedValue({
        merchantId: 'merchant-1',
        allowedIps: ['1.2.3.4'],
      });

      await expect(
        service.enforceIpAllowlist('merchant-1', '1.2.3.4'),
      ).resolves.toBeUndefined();
    });

    it('allows when IP is in an allowed CIDR range', async () => {
      mockIpAllowlistRepo.findOneBy.mockResolvedValue({
        merchantId: 'merchant-1',
        allowedIps: ['10.0.0.0/8'],
      });

      await expect(
        service.enforceIpAllowlist('merchant-1', '10.5.10.1'),
      ).resolves.toBeUndefined();
    });

    it('throws IpAllowlistBlockedException when IP is not in the allowlist', async () => {
      mockIpAllowlistRepo.findOneBy.mockResolvedValue({
        merchantId: 'merchant-1',
        allowedIps: ['1.2.3.4'],
      });

      await expect(
        service.enforceIpAllowlist('merchant-1', '9.9.9.9'),
      ).rejects.toThrow(IpAllowlistBlockedException);
    });

    it('throws IpAllowlistBlockedException when IP is outside CIDR range', async () => {
      mockIpAllowlistRepo.findOneBy.mockResolvedValue({
        merchantId: 'merchant-1',
        allowedIps: ['192.168.1.0/24'],
      });

      await expect(
        service.enforceIpAllowlist('merchant-1', '192.168.2.1'),
      ).rejects.toThrow(IpAllowlistBlockedException);
    });

    it('error has code ip_not_allowed', async () => {
      mockIpAllowlistRepo.findOneBy.mockResolvedValue({
        merchantId: 'merchant-1',
        allowedIps: ['1.2.3.4'],
      });

      try {
        await service.enforceIpAllowlist('merchant-1', '9.9.9.9');
        fail('expected error');
      } catch (err: any) {
        expect(err.getResponse().code).toBe('ip_not_allowed');
      }
    });

    it('does not let a spoofed X-Forwarded-For bypass the allowlist', async () => {
      mockIpAllowlistRepo.findOneBy.mockResolvedValue({
        merchantId: 'merchant-1',
        allowedIps: ['203.0.113.10'],
      });

      // Attacker connects directly (untrusted peer) and forges X-Forwarded-For
      // to match an allowlisted IP.
      const spoofed = {
        socket: { remoteAddress: '198.51.100.7' },
        headers: { 'x-forwarded-for': '203.0.113.10' },
      };
      const clientIp = extractClientIp(spoofed, []);

      expect(clientIp).toBe('198.51.100.7');
      await expect(
        service.enforceIpAllowlist('merchant-1', clientIp),
      ).rejects.toThrow(IpAllowlistBlockedException);
    });

    it('does not let a forged X-Forwarded-For inserted behind a trusted proxy bypass the allowlist', async () => {
      mockIpAllowlistRepo.findOneBy.mockResolvedValue({
        merchantId: 'merchant-1',
        allowedIps: ['203.0.113.10'],
      });

      // Client behind a trusted proxy forges the leading entry; the proxy
      // appends the client's real IP.
      const spoofed = {
        socket: { remoteAddress: '10.0.0.5' },
        headers: { 'x-forwarded-for': '203.0.113.10, 198.51.100.7, 10.0.0.5' },
      };
      const clientIp = extractClientIp(spoofed, ['10.0.0.0/8']);

      expect(clientIp).toBe('198.51.100.7');
      await expect(
        service.enforceIpAllowlist('merchant-1', clientIp),
      ).rejects.toThrow(IpAllowlistBlockedException);
    });

    it('resolves the real client IP when the peer is a trusted proxy', async () => {
      mockIpAllowlistRepo.findOneBy.mockResolvedValue({
        merchantId: 'merchant-1',
        allowedIps: ['198.51.100.7'],
      });

      const proxied = {
        socket: { remoteAddress: '10.0.0.5' },
        headers: { 'x-forwarded-for': '198.51.100.7, 10.0.0.5' },
      };
      const clientIp = extractClientIp(proxied, ['10.0.0.0/8']);

      expect(clientIp).toBe('198.51.100.7');
      await expect(
        service.enforceIpAllowlist('merchant-1', clientIp),
      ).resolves.toBeUndefined();
    });
  });
});
