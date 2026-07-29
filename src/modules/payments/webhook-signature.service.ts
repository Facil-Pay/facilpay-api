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
  private readonly defaultToleranceMinutes = 5;
  private readonly timestampToleranceMs: number;
  private readonly nonceReplayCacheEnabled: boolean;
  private readonly usedNonces = new Map<string, number>();

  constructor(private configService: ConfigService) {
    this.webhookSecret = this.configService.get<string>('WEBHOOK_SECRET') || '';
    const toleranceMinutes = Number(
      this.configService.get<string | number>(
        'WEBHOOK_TIMESTAMP_TOLERANCE_MINUTES',
        this.defaultToleranceMinutes,
      ),
    );
    this.timestampToleranceMs = Math.max(0, toleranceMinutes) * 60 * 1000;
    this.nonceReplayCacheEnabled =
      String(
        this.configService.get<string | boolean>(
          'WEBHOOK_NONCE_REPLAY_CACHE_ENABLED',
          'false',
        ),
      ).toLowerCase() === 'true';

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
   * @param timestamp - The Unix timestamp from X-Signature-Timestamp header (seconds)
   * @param nonce - Optional nonce from X-Signature-Nonce for replay detection
   * @returns True if signature is valid, false otherwise
   */
  verifySignature(
    payload: string | Buffer,
    signature: string,
    timestamp: string,
    nonce?: string,
  ): boolean {
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
      const timestampInSeconds = Number(timestamp);
      if (!Number.isFinite(timestampInSeconds) || timestampInSeconds <= 0) {
        return false;
      }

      const now = Date.now();
      const timestampMs = timestampInSeconds * 1000;
      if (Math.abs(now - timestampMs) > this.timestampToleranceMs) {
        return false;
      }

      if (this.nonceReplayCacheEnabled && nonce) {
        this.pruneExpiredNonces(now);
        if (this.usedNonces.has(nonce)) {
          return false;
        }
      }

      const payloadString =
        typeof payload === 'string' ? payload : payload.toString();
      const expectedSignature = this.generateSignature(payloadString, timestamp);

      // Use constant-time comparison to prevent timing attacks
      const isValid = this.constantTimeCompare(signature, expectedSignature);
      if (isValid && this.nonceReplayCacheEnabled && nonce) {
        this.usedNonces.set(nonce, timestampMs);
      }
      return isValid;
    } catch {
      return false;
    }
  }

  /**
   * Generate a signature for a payload
   * @param payload - The payload to sign
   * @param timestamp - Unix timestamp in seconds used in signing string
   * @returns The generated signature
   */
  generateSignature(payload: string, timestamp: string): string {
    const signedPayload = `${timestamp}.${payload}`;
    return crypto
      .createHmac(this.signatureAlgorithm, this.webhookSecret)
      .update(signedPayload)
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

  private pruneExpiredNonces(nowMs: number): void {
    const expiryThreshold = nowMs - this.timestampToleranceMs;
    for (const [nonce, nonceTimestampMs] of this.usedNonces.entries()) {
      if (nonceTimestampMs < expiryThreshold) {
        this.usedNonces.delete(nonce);
      }
    }
  }
}
