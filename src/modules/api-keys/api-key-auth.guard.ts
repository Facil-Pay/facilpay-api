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
}
