import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MerchantSecurityService } from './merchant-security.service';
import { MailService } from '../auth/mail/mail.service';

@Global()
@Module({ imports: [ConfigModule], providers: [MerchantSecurityService, MailService], exports: [MerchantSecurityService, MailService] })
export class MerchantSecurityModule {}
