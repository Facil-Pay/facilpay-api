import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UnmatchedTransaction } from './entities/unmatched-transaction.entity';
import { UnmatchedTransactionsService } from './unmatched-transactions.service';
import { UnmatchedTransactionsController } from './unmatched-transactions.controller';
import { Payment } from '../payments/payment.entity';
import { EventsModule } from '../events/events.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([UnmatchedTransaction, Payment]),
    EventsModule,
    AuthModule,
  ],
  controllers: [UnmatchedTransactionsController],
  providers: [UnmatchedTransactionsService],
  exports: [UnmatchedTransactionsService],
})
export class UnmatchedTransactionsModule {}
