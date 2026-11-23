import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { ApiKeysService } from './api-keys.service';
import { extractClientIp, parseTrustedProxyList } from '../merchants/ip-utils';
import { REQUIRE_SCOPE_KEY } from './decorators/require-scope.decorator';
import { UsersService } from '../users/users.service';
import { verifySignedRequest } from './request-signing';
import { OAuthService } from '../auth/oauth/oauth.service';

@Injectable()
export class ApiKeyAuthGuard implements CanActivate {
  private readonly trustedProxies: string[];

  constructor(
    private readonly apiKeysService: ApiKeysService,
    private readonly reflector: Reflector,
    configService: ConfigService,
    private readonly usersService: UsersService,
    @Optional() private readonly oauth?: OAuthService,
  ) {
    this.trustedProxies = parseTrustedProxyList(
      configService.get<string>('TRUSTED_PROXY_IPS'),
    );
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    const authorization = request.headers.authorization;
    if (typeof authorization === 'string' && authorization.startsWith('Bearer fp_oauth_access_') && this.oauth) {
      const user = await this.oauth.validateAccessToken(authorization.slice(7));
      this.oauth.assertScopes(user.scopes, this.reflector.get<string[]>(REQUIRE_SCOPE_KEY, context.getHandler()));
      request.user = user;
      return true;
    }

    const plaintext = this.extractKey(request);
    if (!plaintext) {
      throw new UnauthorizedException('Missing API key');
    }

    const apiKey = await this.apiKeysService.validateKey(plaintext, extractClientIp(request, this.trustedProxies));
    await this.usersService.assertMerchantActive(apiKey.userId);
    request.apiKey = apiKey;
    request.user = { id: apiKey.userId };

    // Check granular scopes if required
    const requiredScopes = this.reflector.get<string[]>(
      REQUIRE_SCOPE_KEY,
      context.getHandler(),
    );

    if (requiredScopes && requiredScopes.length > 0) {
      this.validateScopes(apiKey.scopes || [], requiredScopes);
    }

    // Record usage asynchronously (don't await to avoid blocking the request)
    this.recordUsageAsync(
      apiKey.id,
      request.path || request.url,
      request.method,
      extractClientIp(request, this.trustedProxies),
      request.headers['user-agent'],
      request,
    );

    return true;
  }

  private validateScopes(grantedScopes: string[], requiredScopes: string[]): void {
    // Check if key has at least one of the required scopes
    const hasRequiredScope = requiredScopes.some((required) =>
      grantedScopes.includes(required),
    );

    if (!hasRequiredScope) {
      throw new ForbiddenException(
        `API key does not have required scope(s): ${requiredScopes.join(', ')}`,
      );
    }
  }

  private extractKey(request: any): string | null {
    const authHeader: string | undefined = request.headers['authorization'];
    if (authHeader?.startsWith('ApiKey ')) {
      return authHeader.slice(7);
    }
    const xApiKey: string | undefined = request.headers['x-api-key'];
    if (xApiKey) {
      return xApiKey;
    }
    return null;
  }

  private recordUsageAsync(
    apiKeyId: string,
    endpoint: string,
    method: string,
    sourceIp: string | undefined,
    userAgent: string | undefined,
    request: any,
  ): void {
    // Store the request object to capture response status later
    request._apiKeyId = apiKeyId;
    request._usageEndpoint = endpoint;
    request._usageMethod = method;
    request._usageSourceIp = sourceIp || null;
    request._usageUserAgent = userAgent || null;

    // Hook into response finish event to capture status code
    const response = request.res;
    if (response) {
      response.on('finish', () => {
        this.apiKeysService
          .recordUsage(
            apiKeyId,
            endpoint,
            method,
            sourceIp || null,
            userAgent || null,
            response.statusCode,
          )
          .catch((error) => {
            console.error('Failed to record API key usage:', error);
          });
      });
    } else {
      // Fallback: record immediately without status code
      this.apiKeysService
        .recordUsage(
          apiKeyId,
          endpoint,
          method,
          sourceIp || null,
          userAgent || null,
        )
        .catch((error) => {
          console.error('Failed to record API key usage:', error);
        });
    }
  }
}
