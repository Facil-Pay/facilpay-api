import { Injectable, ExecutionContext, Optional } from '@nestjs/common';
import { OAuthService } from '../oauth/oauth.service';
import { REQUIRE_SCOPE_KEY } from '../../api-keys/decorators/require-scope.decorator';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) { super(); }
  canActivate(context: ExecutionContext) {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()])) return true;
    return super.canActivate(context);
  }

  private async authorizeOAuth(context: ExecutionContext, token: string): Promise<boolean> {
    const user = await this.oauth!.validateAccessToken(token);
    const scopes = this.reflector.getAllAndOverride<string[]>(REQUIRE_SCOPE_KEY, [context.getHandler(), context.getClass()]);
    this.oauth!.assertScopes(user.scopes, scopes);
    context.switchToHttp().getRequest().user = user;
    return true;
  }
}
