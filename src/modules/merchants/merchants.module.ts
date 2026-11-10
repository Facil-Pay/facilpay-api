import { MerchantSettings } from './entities/merchant-settings.entity';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { MerchantsService } from './merchants.service';
import { MerchantsController } from './merchants.controller';
import { MerchantGeoRestriction } from './entities/merchant-geo-restriction.entity';
import { MerchantIpAllowlist } from './entities/merchant-ip-allowlist.entity';
import { MerchantOnboarding } from '../onboarding/merchant-onboarding.entity';
import { GeoLookupService } from './geo-lookup.service';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { MerchantLimit } from './entities/merchant-limit.entity';
import { MerchantLimitsService } from './merchant-limits.service';
import { Payment } from '../payments/payment.entity';
import { Dispute } from '../payments/dispute.entity';
import { Payout } from '../payouts/entities/payout.entity';
import { ApiKey } from '../api-keys/api-key.entity';
import { WebhookEndpoint } from '../webhooks/entities/webhook-endpoint.entity';
import { PaymentLink } from '../payment-links/payment-link.entity';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([
      MerchantGeoRestriction,
      MerchantIpAllowlist,
      MerchantOnboarding,
      MerchantLimit,
      Payment,
      MerchantSettings,
      Dispute,
      Payout,
      ApiKey,
      WebhookEndpoint,
      PaymentLink,
    ]),
    AuditLogsModule,
  ],
  controllers: [MerchantsController],
  providers: [MerchantsService, GeoLookupService, MerchantLimitsService],
  exports: [MerchantsService, GeoLookupService, MerchantLimitsService],
})
export class MerchantsModule { }
