import {
  Injectable,
  CanActivate,
  ExecutionContext,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { Request } from 'express';
import { WebhookSignatureService } from './webhook-signature.service';

/**
 * Guard to validate webhook signatures
 * Checks for X-Signature header and verifies it against payload
 */
@Injectable()
export class WebhookGuard implements CanActivate {
  constructor(
    @Inject(WebhookSignatureService)
    private webhookSignatureService: WebhookSignatureService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const signature = request.headers['x-signature'] as string;

    if (!signature) {
      throw new BadRequestException(
        'Missing X-Signature header. Please verify the webhook is correctly configured.',
      );
    }

    // Get raw body for signature verification
    const rawBody = this.getRawBody(request);

    if (!this.webhookSignatureService.verifySignature(rawBody, signature)) {
      throw new BadRequestException(
        'Invalid webhook signature. Unauthorised webhook source.',
      );
    }

    return true;
  }

  /**
   * Extract raw body from request
   * For Express, we need to reconstruct from parsed body
   */
  private getRawBody(request: Request): string {
    if (typeof request.body === 'string') {
      return request.body;
    }
    return JSON.stringify(request.body);
  }
}
