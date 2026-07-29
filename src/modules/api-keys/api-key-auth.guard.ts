import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiKeysService } from './api-keys.service';

@Injectable()
export class ApiKeyAuthGuard implements CanActivate {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    const plaintext = this.extractKey(request);
    if (!plaintext) {
      throw new UnauthorizedException('Missing API key');
    }

    const apiKey = await this.apiKeysService.validateKey(plaintext);
    request.apiKey = apiKey;
    request.user = { id: apiKey.userId };

    // Record usage asynchronously (don't await to avoid blocking the request)
    this.recordUsageAsync(
      apiKey.id,
      request.path || request.url,
      request.method,
      request.ip || request.connection?.remoteAddress,
      request.headers['user-agent'],
      request,
    );

    return true;
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
