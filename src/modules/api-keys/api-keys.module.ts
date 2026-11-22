import { ApiKeyInactivityService } from './api-key-inactivity.service';
import { MerchantSecurityModule } from '../merchants/merchant-security.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { ApiKey } from './api-key.entity';
import { ApiKeyUsage } from './api-key-usage.entity';
import { ApiKeysService } from './api-keys.service';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeyAuthGuard } from './api-key-auth.guard';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [MerchantSecurityModule, NotificationsModule, TypeOrmModule.forFeature([ApiKey, ApiKeyUsage]), ConfigModule, AuditLogsModule, UsersModule],
  controllers: [ApiKeysController],
  providers: [ApiKeysService, ApiKeyAuthGuard, ApiKeyInactivityService],
  exports: [ApiKeysService, ApiKeyAuthGuard],
})
export class ApiKeysModule {}
