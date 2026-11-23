import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Customer } from './customer.entity';
import { CustomerNote } from './entities/customer-note.entity';
import { CustomerWallet } from './entities/customer-wallet.entity';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { CustomerPortalService } from './customer-portal.service';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Customer, CustomerNote, CustomerWallet]),
    AuditLogsModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '1h' },
      }),
      inject: [ConfigService],
    }),
    ConfigModule,
  ],
  controllers: [CustomersController],
  providers: [CustomersService, CustomerPortalService],
  exports: [CustomersService],
})
export class CustomersModule {}
