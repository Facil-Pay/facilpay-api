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

