import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiOkResponse,
  ApiUnauthorizedResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/user.entity';
import { AnalyticsService } from './analytics.service';
import { AnalyticsQueryDto, AnalyticsPeriod } from './dto/analytics-query.dto';
import {
  PaymentMetricsDto,
  CurrencyBreakdownDto,
  StatusBreakdownDto,
} from './dto/analytics-response.dto';

@ApiTags('analytics')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard)
@Controller('v1/analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('payments')
  @ApiOperation({
    summary: 'Get payment metrics',
    description:
      'Returns aggregated payment metrics (total volume, count, and average amount) for the authenticated merchant over the requested time period.',
  })
  @ApiQuery({
    name: 'period',
    enum: AnalyticsPeriod,
    required: false,
    description: 'Time period for aggregation. Defaults to month.',
    example: 'month',
  })
  @ApiOkResponse({
    description: 'Payment metrics successfully retrieved.',
    type: PaymentMetricsDto,
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token.' })
  async getPaymentMetrics(
    @Query() query: AnalyticsQueryDto,
    @CurrentUser() user: User,
  ): Promise<PaymentMetricsDto> {
    return this.analyticsService.getPaymentMetrics(
      user.id,
      query.period ?? AnalyticsPeriod.MONTH,
    );
  }

  @Get('payments/by-currency')
  @ApiOperation({
    summary: 'Get payments breakdown by currency',
    description:
      'Returns payment volume, count, and average amount grouped by currency for the authenticated merchant over the requested time period.',
  })
  @ApiQuery({
    name: 'period',
    enum: AnalyticsPeriod,
    required: false,
    description: 'Time period for aggregation. Defaults to month.',
    example: 'month',
  })
  @ApiOkResponse({
    description: 'Currency breakdown successfully retrieved.',
    type: CurrencyBreakdownDto,
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token.' })
  async getPaymentsByCurrency(
    @Query() query: AnalyticsQueryDto,
    @CurrentUser() user: User,
  ): Promise<CurrencyBreakdownDto> {
    return this.analyticsService.getPaymentsByCurrency(
      user.id,
      query.period ?? AnalyticsPeriod.MONTH,
    );
  }

  @Get('payments/by-status')
  @ApiOperation({
    summary: 'Get payments breakdown by status',
    description:
      'Returns payment count and volume grouped by status, plus overall success and failure rates, for the authenticated merchant over the requested time period.',
  })
  @ApiQuery({
    name: 'period',
    enum: AnalyticsPeriod,
    required: false,
    description: 'Time period for aggregation. Defaults to month.',
    example: 'month',
  })
  @ApiOkResponse({
    description: 'Status breakdown successfully retrieved.',
    type: StatusBreakdownDto,
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid JWT token.' })
  async getPaymentsByStatus(
    @Query() query: AnalyticsQueryDto,
    @CurrentUser() user: User,
  ): Promise<StatusBreakdownDto> {
    return this.analyticsService.getPaymentsByStatus(
      user.id,
      query.period ?? AnalyticsPeriod.MONTH,
    );
  }
}
