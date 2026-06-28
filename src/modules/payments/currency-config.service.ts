import { Injectable } from '@nestjs/common';

export interface CurrencyMetadata {
    code: string;
    name: string;
    symbol: string;
}

const CURRENCY_METADATA: Record<string, { name: string; symbol: string }> = {
    USD: { name: 'US Dollar', symbol: '$' },
    EUR: { name: 'Euro', symbol: '€' },
    GBP: { name: 'British Pound', symbol: '£' },
    JPY: { name: 'Japanese Yen', symbol: '¥' },
    CAD: { name: 'Canadian Dollar', symbol: 'CA$' },
    AUD: { name: 'Australian Dollar', symbol: 'A$' },
    CHF: { name: 'Swiss Franc', symbol: 'CHF' },
    CNY: { name: 'Chinese Yuan', symbol: '¥' },
    INR: { name: 'Indian Rupee', symbol: '₹' },
    MXN: { name: 'Mexican Peso', symbol: 'MX$' },
    BRL: { name: 'Brazilian Real', symbol: 'R$' },
    ZAR: { name: 'South African Rand', symbol: 'R' },
    NGN: { name: 'Nigerian Naira', symbol: '₦' },
    GHS: { name: 'Ghanaian Cedi', symbol: 'GH₵' },
    KES: { name: 'Kenyan Shilling', symbol: 'KSh' },
    XLM: { name: 'Stellar Lumens', symbol: 'XLM' },
    USDC: { name: 'USD Coin', symbol: 'USDC' },
};

@Injectable()
export class CurrencyConfigService {
    private readonly envVarName = 'SUPPORTED_CURRENCIES';

    getSupportedCurrencies(): string[] {
        const raw = process.env[this.envVarName];
        if (!raw || !raw.trim()) return [];
        return raw
            .split(',')
            .map((c) => c.trim().toUpperCase())
            .filter(Boolean);
    }

    getSupportedCurrenciesWithMetadata(): CurrencyMetadata[] {
        return this.getSupportedCurrencies().map((code) => ({
            code,
            name: CURRENCY_METADATA[code]?.name ?? code,
            symbol: CURRENCY_METADATA[code]?.symbol ?? code,
        }));
    }

    getEnvVarName(): string {
        return this.envVarName;
    }
}

