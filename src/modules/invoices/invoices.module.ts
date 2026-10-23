import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsModule } from '../payments/payments.module';
import { ProductsModule } from '../products/products.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { Invoice } from './invoice.entity';
import { InvoiceLineItem } from './invoice-line-item.entity';
import { InvoicesController } from './invoices.controller';
import { PublicInvoicesController } from './public-invoices.controller';
import { InvoicesService } from './invoices.service';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([Invoice, InvoiceLineItem]),
    NotificationsModule,
    PaymentsModule,
    ProductsModule,
    WebhooksModule,
  ],
  controllers: [InvoicesController, PublicInvoicesController],
  providers: [InvoicesService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
