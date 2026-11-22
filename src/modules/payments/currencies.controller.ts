import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrencyConfigService, CurrencyMetadata } from './currency-config.service';

@ApiTags('currencies')
@Controller('v1/currencies')
export class CurrenciesController {
    constructor(private readonly currencyConfigService: CurrencyConfigService) {}

    @Get()
    @ApiOperation({
        summary: 'List supported currencies',
        description:
            'Returns the list of supported ISO 4217 currency codes configured for this API instance, with name and symbol metadata. Returns an empty array when no currencies are configured.',
    })
    @ApiOkResponse({
        description: 'Supported currencies with metadata.',
        schema: {
            example: {
                currencies: [
                    { code: 'USD', name: 'US Dollar', symbol: '$' },
                    { code: 'EUR', name: 'Euro', symbol: '€' },
                    { code: 'GBP', name: 'British Pound', symbol: '£' },
                ],
            },
        },
    })
    getCurrencies(): { currencies: CurrencyMetadata[] } {
        return {
            currencies: this.currencyConfigService.getSupportedCurrenciesWithMetadata(),
        };
    }
}

import { Test, TestingModule } from '@nestjs/testing';
import { CurrencyConfigService, CurrencyMetadata } from './currency-config.service';

describe('CurrencyConfigService', () => {
  let service: CurrencyConfigService;
  const originalEnv = process.env.SUPPORTED_CURRENCIES;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CurrencyConfigService],
    }).compile();

    service = module.get<CurrencyConfigService>(CurrencyConfigService);
  });

  afterEach(() => {
    // Restore original environment variable
    if (originalEnv === undefined) {
      delete process.env.SUPPORTED_CURRENCIES;
    } else {
      process.env.SUPPORTED_CURRENCIES = originalEnv;
    }
  });

  describe('getSupportedCurrencies', () => {
    it('should return empty array when environment variable is not set', () => {
      delete process.env.SUPPORTED_CURRENCIES;

      const result = service.getSupportedCurrencies();

      expect(result).toEqual([]);
    });

    it('should return empty array when environment variable is empty string', () => {
      process.env.SUPPORTED_CURRENCIES = '';

      const result = service.getSupportedCurrencies();

      expect(result).toEqual([]);
    });

    it('should return empty array when environment variable is only whitespace', () => {
      process.env.SUPPORTED_CURRENCIES = '   ';

      const result = service.getSupportedCurrencies();

      expect(result).toEqual([]);
    });

    it('should return single currency when one is configured', () => {
      process.env.SUPPORTED_CURRENCIES = 'USD';

      const result = service.getSupportedCurrencies();

      expect(result).toEqual(['USD']);
    });

    it('should return multiple currencies when configured', () => {
      process.env.SUPPORTED_CURRENCIES = 'USD,EUR,GBP';

      const result = service.getSupportedCurrencies();

      expect(result).toEqual(['USD', 'EUR', 'GBP']);
    });

    it('should handle currencies with spaces around them', () => {
      process.env.SUPPORTED_CURRENCIES = 'USD , EUR , GBP';

      const result = service.getSupportedCurrencies();

      expect(result).toEqual(['USD', 'EUR', 'GBP']);
    });

    it('should convert lowercase currencies to uppercase', () => {
      process.env.SUPPORTED_CURRENCIES = 'usd,eur,gbp';

      const result = service.getSupportedCurrencies();

      expect(result).toEqual(['USD', 'EUR', 'GBP']);
    });

    it('should convert mixed case currencies to uppercase', () => {
      process.env.SUPPORTED_CURRENCIES = 'UsD,EuR,GbP';

      const result = service.getSupportedCurrencies();

      expect(result).toEqual(['USD', 'EUR', 'GBP']);
    });

    it('should filter out empty strings from split', () => {
      process.env.SUPPORTED_CURRENCIES = 'USD,,EUR,,GBP';

      const result = service.getSupportedCurrencies();

      expect(result).toEqual(['USD', 'EUR', 'GBP']);
    });

    it('should handle trailing and leading commas', () => {
      process.env.SUPPORTED_CURRENCIES = ',USD,EUR,';

      const result = service.getSupportedCurrencies();

      expect(result).toEqual(['USD', 'EUR']);
    });

    it('should include crypto currencies when configured', () => {
      process.env.SUPPORTED_CURRENCIES = 'USD,XLM,USDC';

      const result = service.getSupportedCurrencies();

      expect(result).toContain('USD');
      expect(result).toContain('XLM');
      expect(result).toContain('USDC');
    });

    it('should handle large list of currencies', () => {
      const currencies = 'USD,EUR,GBP,JPY,CAD,AUD,CHF,CNY,INR,MXN,BRL,ZAR,NGN,GHS,KES,XLM,USDC';
      process.env.SUPPORTED_CURRENCIES = currencies;

      const result = service.getSupportedCurrencies();

      expect(result.length).toBe(17);
      expect(result).toContain('USD');
      expect(result).toContain('USDC');
    });
  });

  describe('getSupportedCurrenciesWithMetadata', () => {
    it('should return empty array when no currencies configured', () => {
      delete process.env.SUPPORTED_CURRENCIES;

      const result = service.getSupportedCurrenciesWithMetadata();

      expect(result).toEqual([]);
    });

    it('should return currency metadata for single currency', () => {
      process.env.SUPPORTED_CURRENCIES = 'USD';

      const result = service.getSupportedCurrenciesWithMetadata();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        code: 'USD',
        name: 'US Dollar',
        symbol: '$',
      });
    });

    it('should return metadata for multiple currencies', () => {
      process.env.SUPPORTED_CURRENCIES = 'USD,EUR,GBP';

      const result = service.getSupportedCurrenciesWithMetadata();

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ code: 'USD', name: 'US Dollar', symbol: '$' });
      expect(result[1]).toEqual({ code: 'EUR', name: 'Euro', symbol: '€' });
      expect(result[2]).toEqual({ code: 'GBP', name: 'British Pound', symbol: '£' });
    });

    it('should return code as both name and symbol for unknown currency', () => {
      process.env.SUPPORTED_CURRENCIES = 'UNKNOWN';

      const result = service.getSupportedCurrenciesWithMetadata();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        code: 'UNKNOWN',
        name: 'UNKNOWN',
        symbol: 'UNKNOWN',
      });
    });

    it('should handle mix of known and unknown currencies', () => {
      process.env.SUPPORTED_CURRENCIES = 'USD,UNKNOWN,EUR';

      const result = service.getSupportedCurrenciesWithMetadata();

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ code: 'USD', name: 'US Dollar', symbol: '$' });
      expect(result[1]).toEqual({ code: 'UNKNOWN', name: 'UNKNOWN', symbol: 'UNKNOWN' });
      expect(result[2]).toEqual({ code: 'EUR', name: 'Euro', symbol: '€' });
    });

    it('should include all predefined currencies', () => {
      process.env.SUPPORTED_CURRENCIES = 'USD,EUR,GBP,JPY,CAD,AUD,CHF,CNY,INR,MXN,BRL,ZAR,NGN,GHS,KES,XLM,USDC';

      const result = service.getSupportedCurrenciesWithMetadata();

      expect(result.length).toBeGreaterThan(0);
      expect(result.every((c) => c.code && c.name && c.symbol)).toBe(true);
    });

    it('should have CurrencyMetadata structure', () => {
      process.env.SUPPORTED_CURRENCIES = 'USD';

      const result = service.getSupportedCurrenciesWithMetadata();

      result.forEach((currency: CurrencyMetadata) => {
        expect(currency).toHaveProperty('code');
        expect(currency).toHaveProperty('name');
        expect(currency).toHaveProperty('symbol');
        expect(typeof currency.code).toBe('string');
        expect(typeof currency.name).toBe('string');
        expect(typeof currency.symbol).toBe('string');
      });
    });

    it('should preserve order of currencies from environment', () => {
      process.env.SUPPORTED_CURRENCIES = 'EUR,USD,GBP';

      const result = service.getSupportedCurrenciesWithMetadata();

      expect(result[0].code).toBe('EUR');
      expect(result[1].code).toBe('USD');
      expect(result[2].code).toBe('GBP');
    });
  });

  describe('getEnvVarName', () => {
    it('should return the environment variable name', () => {
      const result = service.getEnvVarName();

      expect(result).toBe('SUPPORTED_CURRENCIES');
    });

    it('should return consistent value across multiple calls', () => {
      const result1 = service.getEnvVarName();
      const result2 = service.getEnvVarName();

      expect(result1).toBe(result2);
      expect(result1).toBe('SUPPORTED_CURRENCIES');
    });
  });

  describe('currency symbols and names', () => {
    it('should have correct symbols for all predefined currencies', () => {
      const expectedSymbols: Record<string, string> = {
        USD: '$',
        EUR: '€',
        GBP: '£',
        JPY: '¥',
        CAD: 'CA$',
        AUD: 'A$',
        CHF: 'CHF',
        CNY: '¥',
        INR: '₹',
        MXN: 'MX$',
        BRL: 'R$',
        ZAR: 'R',
        NGN: '₦',
        GHS: 'GH₵',
        KES: 'KSh',
        XLM: 'XLM',
        USDC: 'USDC',
      };

      process.env.SUPPORTED_CURRENCIES = Object.keys(expectedSymbols).join(',');

      const result = service.getSupportedCurrenciesWithMetadata();

      result.forEach((currency) => {
        if (currency.code in expectedSymbols) {
          expect(currency.symbol).toBe(expectedSymbols[currency.code]);
        }
      });
    });

    it('should have correct names for all predefined currencies', () => {
      const expectedNames: Record<string, string> = {
        USD: 'US Dollar',
        EUR: 'Euro',
        GBP: 'British Pound',
        JPY: 'Japanese Yen',
        CAD: 'Canadian Dollar',
        AUD: 'Australian Dollar',
        CHF: 'Swiss Franc',
        CNY: 'Chinese Yuan',
        INR: 'Indian Rupee',
        MXN: 'Mexican Peso',
        BRL: 'Brazilian Real',
        ZAR: 'South African Rand',
        NGN: 'Nigerian Naira',
        GHS: 'Ghanaian Cedi',
        KES: 'Kenyan Shilling',
        XLM: 'Stellar Lumens',
        USDC: 'USD Coin',
      };

      process.env.SUPPORTED_CURRENCIES = Object.keys(expectedNames).join(',');

      const result = service.getSupportedCurrenciesWithMetadata();

      result.forEach((currency) => {
        if (currency.code in expectedNames) {
          expect(currency.name).toBe(expectedNames[currency.code]);
        }
      });
    });
  });

  describe('integration scenarios', () => {
    it('should handle typical fiat currency setup', () => {
      process.env.SUPPORTED_CURRENCIES = 'USD,EUR,GBP';

      const currencies = service.getSupportedCurrencies();
      const metadata = service.getSupportedCurrenciesWithMetadata();

      expect(currencies).toHaveLength(3);
      expect(metadata).toHaveLength(3);
      expect(metadata[0].code).toBe('USD');
      expect(metadata[1].code).toBe('EUR');
      expect(metadata[2].code).toBe('GBP');
    });

    it('should handle typical crypto currency setup', () => {
      process.env.SUPPORTED_CURRENCIES = 'XLM,USDC';

      const currencies = service.getSupportedCurrencies();
      const metadata = service.getSupportedCurrenciesWithMetadata();

      expect(currencies).toEqual(['XLM', 'USDC']);
      expect(metadata[0]).toEqual({ code: 'XLM', name: 'Stellar Lumens', symbol: 'XLM' });
      expect(metadata[1]).toEqual({ code: 'USDC', name: 'USD Coin', symbol: 'USDC' });
    });

    it('should handle mixed fiat and crypto currencies', () => {
      process.env.SUPPORTED_CURRENCIES = 'USD,EUR,XLM,USDC';

      const currencies = service.getSupportedCurrencies();

      expect(currencies).toContain('USD');
      expect(currencies).toContain('EUR');
      expect(currencies).toContain('XLM');
      expect(currencies).toContain('USDC');
    });

    it('should handle global currency configuration', () => {
      process.env.SUPPORTED_CURRENCIES = 'USD,EUR,GBP,JPY,CAD,AUD,CHF,CNY,INR,MXN,BRL,ZAR,NGN,GHS,KES,XLM,USDC';

      const currencies = service.getSupportedCurrencies();
      const metadata = service.getSupportedCurrenciesWithMetadata();

      expect(currencies.length).toBe(17);
      expect(metadata.length).toBe(17);
      expect(currencies.every((c) => typeof c === 'string')).toBe(true);
      expect(metadata.every((m) => m.code && m.name && m.symbol)).toBe(true);
    });
  });

  describe('edge case handling', () => {
    it('should handle duplicate currencies', () => {
      process.env.SUPPORTED_CURRENCIES = 'USD,USD,EUR';

      const result = service.getSupportedCurrencies();

      // Should include duplicates as per environment variable
      expect(result).toContain('USD');
      expect(result).toContain('EUR');
    });

    it('should handle special whitespace characters', () => {
      process.env.SUPPORTED_CURRENCIES = 'USD\t,\tEUR\n,\nGBP';

      const result = service.getSupportedCurrencies();

      expect(result).toContain('USD');
      expect(result).toContain('EUR');
      expect(result).toContain('GBP');
    });
  });
});
