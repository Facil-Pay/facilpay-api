import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/user.entity';
import { PaymentsService } from './payments.service';

@ApiTags('merchants')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard)
@Controller('v1/merchants/me')
export class MerchantFeesController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get('fee-config')
  @ApiOperation({
    summary: 'Get current merchant fee configuration',
    description:
      'Returns the authenticated merchant fee config. No admin role required.',
  })
  getMyFeeConfig(@CurrentUser() user: User) {
    return this.paymentsService.getMerchantFeeConfig(user.id);
  }

  @Get('fee-report')
  @ApiOperation({
    summary: 'Get current merchant fee report',
    description:
      'Returns gross/fee/net totals for the authenticated merchant only. No admin role required.',
  })
  getMyFeeReport(@CurrentUser() user: User) {
    return this.paymentsService.getFeeReport(user.id);
  }
}
