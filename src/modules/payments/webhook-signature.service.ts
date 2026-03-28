import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

/**
 * Webhook signature verification service
 * Supports common webhook signature methods: HMAC-SHA256, HMAC-SHA1
 */
@Injectable()
export class WebhookSignatureService {
  private readonly webhookSecret: string;
  private readonly signatureAlgorithm = 'sha256';
  private readonly signatureHeader = 'x-signature';

  constructor(private configService: ConfigService) {
    this.webhookSecret = this.configService.get<string>('WEBHOOK_SECRET') || '';

    if (!this.webhookSecret) {
      console.warn(
        'WEBHOOK_SECRET not configured. Webhook signature verification will be disabled.',
      );
    }
  }

  /**
   * Verify webhook signature
   * @param payload - The raw request body
   * @param signature - The signature from the X-Signature header
   * @returns True if signature is valid, false otherwise
   */
  verifySignature(payload: string | Buffer, signature: string): boolean {
    if (!this.webhookSecret) {
      console.warn(
        'WEBHOOK_SECRET not configured. Skipping signature verification.',
      );
      return false;
    }

    if (!signature) {
      return false;
    }

    try {
      const payloadString =
        typeof payload === 'string' ? payload : payload.toString();
      const expectedSignature = this.generateSignature(payloadString);

      // Use constant-time comparison to prevent timing attacks
      return this.constantTimeCompare(signature, expectedSignature);
    } catch {
      return false;
    }
  }

  /**
   * Generate a signature for a payload
   * @param payload - The payload to sign
   * @returns The generated signature
   */
  generateSignature(payload: string): string {
    return crypto
      .createHmac(this.signatureAlgorithm, this.webhookSecret)
      .update(payload)
      .digest('hex');
  }

  /**
   * Constant-time string comparison to prevent timing attacks
   * @param a - String to compare
   * @param b - String to compare
   * @returns True if strings are equal
   */
  private constantTimeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }

    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
  }
}
