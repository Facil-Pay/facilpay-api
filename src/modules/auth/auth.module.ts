import { SamlController } from './saml.controller';
import { SamlService } from './saml.service';
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { UsersModule } from '../users/users.module';
import { SessionsModule } from '../sessions/sessions.module';
import { JwtStrategy } from './jwt.strategy';
import { RefreshToken } from './entities/refresh-token.entity';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { PasswordHistory } from './entities/password-history.entity';
import { Role } from './entities/role.entity';
import { LoginEvent } from './entities/login-event.entity';
import { MailService } from './mail/mail.service';
import { PasswordStrengthService } from './password-strength.service';
import { PasswordHistoryService } from './password-history.service';
import { LoginHistoryService } from './login-history.service';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { User } from '../users/user.entity';
import { WebAuthnCredential } from './entities/webauthn-credential.entity';
import { WebAuthnChallenge } from './entities/webauthn-challenge.entity';
import { WebAuthnService } from './webauthn.service';
import { LoginAlertActionToken } from './entities/login-alert-action-token.entity';
import { LoginAlertsService } from './login-alerts.service';
import { MerchantsModule } from '../merchants/merchants.module';
import { Session } from './entities/session.entity';

@Module({
  imports: [
    UsersModule,
    PassportModule,
    HttpModule,
    SessionsModule,
    MerchantsModule,
    TypeOrmModule.forFeature([
      RefreshToken,
      LoginEvent,
      PasswordResetToken,
      PasswordHistory,
      Role,
      User,
      WebAuthnCredential,
      WebAuthnChallenge,
      LoginAlertActionToken,
      Session,
    ]),
    AuditLogsModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET') || 'your-secret-key',
        signOptions: { expiresIn: '24h' },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController, SamlController],
  providers: [
    AuthService,
    SamlService,
    WebAuthnService,
    LoginAlertsService,
    JwtStrategy,
    JwtAuthGuard,
    RolesGuard,
    PermissionsGuard,
    MailService,
    PasswordStrengthService,
    PasswordHistoryService,
    LoginHistoryService,
  ],
  exports: [
    AuthService,
    MailService,
    JwtAuthGuard,
    RolesGuard,
    PermissionsGuard,
    PasswordStrengthService,
    PasswordHistoryService,
    LoginHistoryService,
  ],
})
export class AuthModule {}
