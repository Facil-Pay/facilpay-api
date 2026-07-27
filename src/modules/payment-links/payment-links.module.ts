import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentLink } from './payment-link.entity';
import { PaymentLinksService } from './payment-links.service';
import { PaymentLinksController } from './payment-links.controller';

@Module({
  imports: [TypeOrmModule.forFeature([PaymentLink])],
  controllers: [PaymentLinksController],
  providers: [PaymentLinksService],
  exports: [PaymentLinksService],
})
export class PaymentLinksModule {}
