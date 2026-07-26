import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { GeoLookupService } from './geo-lookup.service';
import * as geoip from 'geoip-lite';

jest.mock('geoip-lite', () => ({
  lookup: jest.fn(),
}));

describe('GeoLookupService', () => {
  let service: GeoLookupService;
  const mockLookup = geoip.lookup as jest.Mock;

  beforeEach(async () => {
    mockLookup.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GeoLookupService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn((_key, defaultValue) => defaultValue) },
        },
      ],
    }).compile();

    service = module.get<GeoLookupService>(GeoLookupService);
  });

  it('should return the country code resolved by geoip-lite', () => {
    mockLookup.mockReturnValue({ country: 'US' });

    expect(service.lookupCountry('8.8.8.8')).toBe('US');
    expect(mockLookup).toHaveBeenCalledWith('8.8.8.8');
  });

  it('should return null when the IP cannot be resolved', () => {
    mockLookup.mockReturnValue(null);

    expect(service.lookupCountry('127.0.0.1')).toBeNull();
  });

  it('should cache the result and not call geoip-lite again for the same IP', () => {
    mockLookup.mockReturnValue({ country: 'GB' });

    expect(service.lookupCountry('1.1.1.1')).toBe('GB');
    expect(service.lookupCountry('1.1.1.1')).toBe('GB');
    expect(mockLookup).toHaveBeenCalledTimes(1);
  });
});
