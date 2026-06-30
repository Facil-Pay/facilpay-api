import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StellarService } from './stellar.service';
import { StellarHorizonStreamService } from './stellar-horizon-stream.service';
import { Payment } from '../payments/payment.entity';
import { MultiSigTransaction } from './entities/multi-sig-transaction.entity';
import { StellarController } from './stellar.controller';
import { WebhooksModule } from '../webhooks/webhooks.module';

@Module({
  imports: [ConfigModule, TypeOrmModule.forFeature([Payment, MultiSigTransaction]), forwardRef(() => WebhooksModule)],
  controllers: [StellarController],
  providers: [StellarService, StellarHorizonStreamService],
  exports: [StellarService, StellarHorizonStreamService],
})
export class StellarModule {}
