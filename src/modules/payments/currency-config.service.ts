import { Injectable } from '@nestjs/common';

@Injectable()
export class CurrencyConfigService {
    private readonly envVarName = 'SUPPORTED_CURRENCIES';

    /**
     * Reads supported currencies from env.
     * Format: comma-separated ISO 4217 codes, e.g. "USD,EUR,GBP"
     */
    getSupportedCurrencies(): string[] {
        const raw = process.env[this.envVarName];

        // Default to a small but useful set to keep the API functional.
        // Tests/consumers can override via env without code changes.
        const fallback = ['USD', 'EUR', 'GBP'];

        if (!raw || !raw.trim()) return fallback;

        return raw
            .split(',')
            .map((c) => c.trim().toUpperCase())
            .filter(Boolean);
    }

    getEnvVarName(): string {
        return this.envVarName;
    }
}

