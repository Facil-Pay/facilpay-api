import { MerchantSettings } from '../merchants/entities/merchant-settings.entity';
import { MerchantMember } from '../team/entities/merchant-member.entity';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Session } from './session.entity';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { SessionsService } from './sessions.service';
import { SessionsController } from './sessions.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Session, RefreshToken, MerchantSettings, MerchantMember])],
  controllers: [SessionsController],
  providers: [SessionsService],
  exports: [SessionsService],
})
export class SessionsModule {}
