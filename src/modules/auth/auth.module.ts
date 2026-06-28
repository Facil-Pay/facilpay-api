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
import { UsersModule } from '../users/users.module';
import { JwtStrategy } from './jwt.strategy';
import { RefreshToken } from './entities/refresh-token.entity';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { MailService } from './mail/mail.service';
import { PasswordStrengthService } from './password-strength.service';

@Module({
  imports: [
    UsersModule,
    PassportModule,
    HttpModule,
    TypeOrmModule.forFeature([RefreshToken, PasswordResetToken]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET') || 'your-secret-key',
        signOptions: { expiresIn: '24h' },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, JwtAuthGuard, RolesGuard, MailService, PasswordStrengthService],
  exports: [AuthService, JwtAuthGuard, RolesGuard, PasswordStrengthService],
})
export class AuthModule {}
