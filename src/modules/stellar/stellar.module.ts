import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StellarService } from './stellar.service';
import { StellarHorizonStreamService } from './stellar-horizon-stream.service';
import { StellarHorizonClientService } from './stellar-horizon-client.service';
import { Payment } from '../payments/payment.entity';
import { MultiSigTransaction } from './entities/multi-sig-transaction.entity';
import { StellarAsset } from './entities/stellar-asset.entity';
import { StellarController } from './stellar.controller';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { AuthModule } from '../auth/auth.module';
import { UnmatchedTransactionsModule } from '../unmatched-transactions/unmatched-transactions.module';

@Module({
  imports: [ConfigModule, TypeOrmModule.forFeature([Payment, MultiSigTransaction, StellarAsset]), forwardRef(() => WebhooksModule), AuthModule, UnmatchedTransactionsModule],
  controllers: [StellarController],
  providers: [StellarService, StellarHorizonStreamService, StellarHorizonClientService],
  exports: [StellarService, StellarHorizonStreamService, StellarHorizonClientService],
})
export class StellarModule {}
