import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../../users/users.module';
import { OAuthClient, OAuthCredential, OAuthGrant } from './oauth.entity';
import { OAuthController } from './oauth.controller';
import { OAuthService } from './oauth.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([OAuthClient, OAuthGrant, OAuthCredential]), UsersModule],
  controllers: [OAuthController], providers: [OAuthService], exports: [OAuthService],
})
export class OAuthModule {}
