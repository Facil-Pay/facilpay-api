import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiKey } from './api-key.entity';
import { ApiKeysService } from './api-keys.service';
import { ApiKeysController } from './api-keys.controller';
import { ApiKeyAuthGuard } from './api-key-auth.guard';

@Module({
  imports: [TypeOrmModule.forFeature([ApiKey])],
  controllers: [ApiKeysController],
  providers: [ApiKeysService, ApiKeyAuthGuard],
  exports: [ApiKeysService, ApiKeyAuthGuard],
})
export class ApiKeysModule {}
