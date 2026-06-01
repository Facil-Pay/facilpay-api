import {
    registerDecorator,
    ValidationArguments,
    ValidationOptions,
} from 'class-validator';

const SUPPORTED_CURRENCIES_ENV_VAR = 'SUPPORTED_CURRENCIES';

// NOTE: This validator is implemented as a pure decorator (not DI-driven),
// so we intentionally read env directly here.
function getSupportedCurrenciesFromEnv(): string[] {
    const raw = process.env[SUPPORTED_CURRENCIES_ENV_VAR];
    const fallback = ['USD', 'EUR', 'GBP'];
    if (!raw || !raw.trim()) return fallback;
    return raw
        .split(',')
        .map((c) => c.trim().toUpperCase())
        .filter(Boolean);
}


// NOTE: Minimal ISO 4217 allowlist. Extend as needed.
// The goal is correctness + deterministic validation.
const ISO_4217_CURRENCY_CODES = new Set<string>([
    // Common
    'USD',
    'EUR',
    'GBP',
    'JPY',
    'AUD',
    'CAD',
    'CHF',
    'CNY',
    'SEK',
    'NZD',
    'NOK',
    'MXN',
    'SGD',
    'HKD',
    'KRW',
    'INR',
    'BRL',
    'ZAR',
    'PLN',
    'TRY',
    'CZK',
    'DKK',
    'HUF',
    'ILS',
    'AED',
    'SAR',
    'KWD',
    'QAR',
    'BHD',
    'OMR',
    'EGP',
    'NGN',
    'KES',
    'TZS',
    'GHS',
    'MAD',
    'TND',
    'DZD',
    'LYD',
    'KGS',
    'UZS',
    'AMD',
    'AZN',
    'TMT',
    'RUB',
    'UAH',
    'RON',
    'BGN',
    'HRK',
    'RSD',
    'ISK',
    'LTL',
    'LVL',
    'BAM',
    'MKD',
    'ALL',
    'MDL',
    'MNT',
    'GEL',
    'KZT',
    'SPL',
    'GTQ',
    'HNL',
    'NIO',
    'CRC',
    'PEN',
    'COP',
    'CLP',
    'UYU',
    'PYG',
    'BZD',
    'TTD',
    'BSD',
    'BBD',
    'JMD',
    'AWG',
    'ANG',
    'TTT',
    'XAF',
    'XOF',
    'XCD',
    'XPF',
    'CVE',
    'ANG',
    // Add more codes incrementally when needed.
]);

type Options = {
    supportedOnly?: boolean;
};

/**
 * Custom decorator to validate an ISO 4217 currency code.
 *
 * - Validates the code is an ISO 4217 currency code (via internal allowlist)
 * - Optionally validates it is part of the supported currencies allowlist loaded from env.
 */
export function IsISO4217CurrencyCode(
    validationOptions?: ValidationOptions & Options,
): PropertyDecorator {
    const supportedOnly = Boolean(validationOptions?.supportedOnly);

    return function (object: Object, propertyName: string | symbol) {
        registerDecorator({
            name: 'IsISO4217CurrencyCode',
            target: object.constructor,
            propertyName: propertyName.toString(),
            options: validationOptions,
            constraints: [supportedOnly],
            validator: {
                validate(value: unknown, args: ValidationArguments) {
                    if (typeof value !== 'string') return false;
                    const code = value.trim().toUpperCase();
                    if (!/^[A-Z]{3}$/.test(code)) return false;

                    // ISO correctness check
                    if (!ISO_4217_CURRENCY_CODES.has(code)) return false;

                    if (supportedOnly) {
                        const supported = getSupportedCurrenciesFromEnv();
                        return supported.includes(code);
                    }


                    return true;
                },
                defaultMessage(args: ValidationArguments) {
                    const raw = args.value;
                    const code = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
                    const supported = getSupportedCurrenciesFromEnv();


                    if (!code || !/^[A-Z]{3}$/.test(code)) {
                        return `Currency must be a valid ISO 4217 code (e.g. USD)`;
                    }

                    if (!ISO_4217_CURRENCY_CODES.has(code)) {
                        return `Currency code '${code}' is not a valid ISO 4217 currency code`;
                    }

                    if (supportedOnly && !supported.includes(code)) {
                        return `Currency '${code}' is not supported. Supported currencies: ${supported.join(', ')}`;
                    }

                    return `Currency '${code}' is invalid`;
                },
            },
        });
    };
}

