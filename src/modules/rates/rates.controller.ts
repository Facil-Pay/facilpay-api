import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiOkResponse } from '@nestjs/swagger';
import { RatesService, RateResult } from './rates.service';
import { GetRateDto } from './dto/get-rate.dto';

@ApiTags('rates')
@Controller('v1/rates')
export class RatesController {
  constructor(private readonly ratesService: RatesService) {}

  @Get()
  @ApiOperation({
    summary: 'Get the current exchange rate between two currencies',
    description:
      'Returns the current FX rate, served from Redis cache when available (default TTL 60s), ' +
      'falling back to the most recent known rate if the upstream provider is unavailable.',
  })
  @ApiQuery({ name: 'from', required: true, example: 'USD' })
  @ApiQuery({ name: 'to', required: true, example: 'XLM' })
  @ApiOkResponse({
    description: 'Current exchange rate.',
    schema: {
      example: { from: 'USD', to: 'XLM', rate: 8.42, source: 'cache' },
    },
  })
  getRate(@Query() query: GetRateDto): Promise<RateResult> {
    return this.ratesService.getRate(query.from, query.to);
  }
}
