import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { MerchantSecurityService } from '../merchants/merchant-security.service';
import { SessionsService } from '../sessions/sessions.service';
import { AuthService } from './auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private authService: AuthService,
    private readonly security: MerchantSecurityService,
    private sessionsService: SessionsService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      passReqToCallback: true,
      secretOrKey: configService.get<string>('JWT_SECRET') || 'your-secret-key',
    });
  }

  async validate(request: Request, payload: any) {
    if (payload.purpose) throw new UnauthorizedException('An access token is required');
    const user = await this.authService.validateUser(payload.sub);
    if (!user) throw new UnauthorizedException();
    if (payload.sid) {
      const session = await this.sessionsService.touchSession(payload.sid, undefined, undefined, user.id);
      if (!session) throw new UnauthorizedException('Session expired or revoked');
    }
    await this.security.enforce(user.id, request.method, request.path);
    return { ...user, roles: user.roles || [] };
  }
}
