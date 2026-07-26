import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { MerchantsService } from './merchants.service';
import { MerchantsController } from './merchants.controller';
import { MerchantGeoRestriction } from './entities/merchant-geo-restriction.entity';
import { GeoLookupService } from './geo-lookup.service';

@Module({
  imports: [ConfigModule, TypeOrmModule.forFeature([MerchantGeoRestriction])],
  controllers: [MerchantsController],
  providers: [MerchantsService, GeoLookupService],
  exports: [MerchantsService],
})
export class MerchantsModule {}
