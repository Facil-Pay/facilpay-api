import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrencyConfigService } from './currency-config.service';

@ApiTags('currencies')
@Controller('v1/currencies')
export class CurrenciesController {
    constructor(private readonly currencyConfigService: CurrencyConfigService) { }

    @Get()
    @ApiOkResponse({
        description: 'Returns the supported currency codes for this API instance.',
        schema: {
            example: {
                currencies: ['USD', 'EUR', 'GBP'],
            },
        },
    })
    getCurrencies() {
        return {
            currencies: this.currencyConfigService.getSupportedCurrencies(),
        };
    }
}

