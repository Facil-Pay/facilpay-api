import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/user.entity';
import {
  AnalyticsService,
  PaymentAnalyticsResult,
  RefundsDisputesAnalyticsResult,
} from './analytics.service';
import { GetPaymentAnalyticsDto } from './dto/get-payment-analytics.dto';

@ApiTags('analytics')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard)
@Controller('v1/analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('payments')
  @ApiOperation({
    summary: 'Time-series payment analytics for the authenticated merchant',
    description:
      'Returns gross, fees, refunds, net, count, success rate and average ticket per bucket. Buckets follow the merchant timezone (or `timezone`) and stay aligned to local boundaries across DST changes. Results are cached for 60 seconds.',
  })
  @ApiOkResponse({ description: 'Bucketed analytics series.' })
  @ApiBadRequestResponse({ description: 'Invalid range or too many buckets.' })
  getPayments(
    @CurrentUser() user: User,
    @Query() query: GetPaymentAnalyticsDto,
  ): Promise<PaymentAnalyticsResult> {
    return this.analyticsService.getPaymentAnalytics(user.id, query);
  }

  @Get('refunds-disputes')
  @ApiOperation({
    summary: 'Time-series refund and dispute analytics for the authenticated merchant',
    description:
      'Returns affected payment counts, amounts, and rates per bucket. Rates are affected captured payments divided by captured payments in the same bucket. Buckets follow the merchant timezone (or `timezone`).',
  })
  @ApiOkResponse({ description: 'Bucketed refund and dispute analytics.' })
  @ApiBadRequestResponse({ description: 'Invalid range or too many buckets.' })
  getRefundsDisputes(
    @CurrentUser() user: User,
    @Query() query: GetPaymentAnalyticsDto,
  ): Promise<RefundsDisputesAnalyticsResult> {
    return this.analyticsService.getRefundsDisputesAnalytics(user.id, query);
  }
}
