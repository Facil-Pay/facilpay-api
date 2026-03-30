import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { StellarService } from './stellar.service';

@Module({
  imports: [ConfigModule],
  providers: [StellarService],
  exports: [StellarService], // Export so PaymentsModule can use it
})
export class StellarModule {}