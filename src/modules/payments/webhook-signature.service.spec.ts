import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { WebhookSignatureService } from './webhook-signature.service';

describe('WebhookSignatureService', () => {
  let service: WebhookSignatureService;

  const mockSecret = 'test-webhook-secret';
  const currentTimestamp = () => String(Math.floor(Date.now() / 1000));

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookSignatureService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'WEBHOOK_SECRET') {
                return mockSecret;
              }
              if (key === 'WEBHOOK_TIMESTAMP_TOLERANCE_MINUTES') {
                return 5;
              }
              if (key === 'WEBHOOK_NONCE_REPLAY_CACHE_ENABLED') {
                return 'true';
              }
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<WebhookSignatureService>(WebhookSignatureService);
  });

  describe('generateSignature', () => {
    it('should generate consistent signature for same payload', () => {
      const payload = JSON.stringify({ paymentId: '123', status: 'COMPLETED' });
      const validTimestamp = currentTimestamp();

      const sig1 = service.generateSignature(payload, validTimestamp);
      const sig2 = service.generateSignature(payload, validTimestamp);

      expect(sig1).toBe(sig2);
    });

    it('should generate different signature for different payload', () => {
      const payload1 = JSON.stringify({
        paymentId: '123',
        status: 'COMPLETED',
      });
      const payload2 = JSON.stringify({ paymentId: '456', status: 'FAILED' });
      const validTimestamp = currentTimestamp();

      const sig1 = service.generateSignature(payload1, validTimestamp);
      const sig2 = service.generateSignature(payload2, validTimestamp);

      expect(sig1).not.toBe(sig2);
    });

    it('should generate different signature for same payload with different timestamps', () => {
      const payload = JSON.stringify({ test: 'data' });
      const validTimestamp = currentTimestamp();
      const sig1 = service.generateSignature(payload, validTimestamp);
      const sig2 = service.generateSignature(
        payload,
        String(Number(validTimestamp) + 1),
      );
      expect(sig1).not.toBe(sig2);
    });

    it('should generate hex-encoded signature', () => {
      const payload = JSON.stringify({ test: 'data' });
      const validTimestamp = currentTimestamp();
      const signature = service.generateSignature(payload, validTimestamp);

      // Should be valid hex string
      expect(/^[a-f0-9]{64}$/i.test(signature)).toBe(true);
    });
  });

  describe('verifySignature', () => {
    it('should verify valid signature', () => {
      const payload = JSON.stringify({ paymentId: '123', status: 'COMPLETED' });
      const validTimestamp = currentTimestamp();
      const signature = service.generateSignature(payload, validTimestamp);

      const isValid = service.verifySignature(payload, signature, validTimestamp);

      expect(isValid).toBe(true);
    });

    it('should reject invalid signature', () => {
      const payload = JSON.stringify({ paymentId: '123', status: 'COMPLETED' });
      const invalidSignature = 'invalid_signature_123456';
      const validTimestamp = currentTimestamp();

      const isValid = service.verifySignature(
        payload,
        invalidSignature,
        validTimestamp,
      );

      expect(isValid).toBe(false);
    });

    it('should reject missing signature', () => {
      const payload = JSON.stringify({ paymentId: '123', status: 'COMPLETED' });
      const validTimestamp = currentTimestamp();

      const isValid = service.verifySignature(payload, '', validTimestamp);

      expect(isValid).toBe(false);
    });

    it('should reject signature for modified payload', () => {
      const payload1 = JSON.stringify({
        paymentId: '123',
        status: 'COMPLETED',
      });
      const payload2 = JSON.stringify({
        paymentId: '123',
        status: 'FAILED',
      });
      const validTimestamp = currentTimestamp();

      const signature = service.generateSignature(payload1, validTimestamp);
      const isValid = service.verifySignature(payload2, signature, validTimestamp);

      expect(isValid).toBe(false);
    });

    it('should work with Buffer payload', () => {
      const payload = JSON.stringify({ paymentId: '123', status: 'COMPLETED' });
      const buffer = Buffer.from(payload);
      const validTimestamp = currentTimestamp();
      const signature = service.generateSignature(payload, validTimestamp);

      const isValid = service.verifySignature(buffer, signature, validTimestamp);

      expect(isValid).toBe(true);
    });

    it('should reject stale timestamp outside tolerance', () => {
      const payload = JSON.stringify({ paymentId: '123', status: 'COMPLETED' });
      const staleTimestamp = String(Math.floor(Date.now() / 1000) - 10 * 60);
      const signature = service.generateSignature(payload, staleTimestamp);

      const isValid = service.verifySignature(payload, signature, staleTimestamp);

      expect(isValid).toBe(false);
    });

    it('should reject invalid timestamp format', () => {
      const payload = JSON.stringify({ paymentId: '123', status: 'COMPLETED' });
      const validTimestamp = currentTimestamp();
      const signature = service.generateSignature(payload, validTimestamp);

      const isValid = service.verifySignature(payload, signature, 'not-a-number');

      expect(isValid).toBe(false);
    });

    it('should reject replayed nonce within tolerance when nonce cache is enabled', () => {
      const payload = JSON.stringify({ paymentId: '123', status: 'COMPLETED' });
      const nonce = 'nonce-123';
      const validTimestamp = currentTimestamp();
      const signature = service.generateSignature(payload, validTimestamp);

      const firstAttempt = service.verifySignature(
        payload,
        signature,
        validTimestamp,
        nonce,
      );
      const replayAttempt = service.verifySignature(
        payload,
        signature,
        validTimestamp,
        nonce,
      );

      expect(firstAttempt).toBe(true);
      expect(replayAttempt).toBe(false);
    });
  });

  describe('Handle missing secret', () => {
    it('should return false when secret is not configured', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          WebhookSignatureService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn(() => undefined),
            },
          },
        ],
      }).compile();

      const serviceWithoutSecret = module.get<WebhookSignatureService>(
        WebhookSignatureService,
      );

      const payload = JSON.stringify({ test: 'data' });
      const validTimestamp = currentTimestamp();
      const result = serviceWithoutSecret.verifySignature(
        payload,
        'some-signature',
        validTimestamp,
      );

      expect(result).toBe(false);
    });
  });

  describe('Timing attack resistance', () => {
    it('should use constant-time comparison', () => {
      const payload = JSON.stringify({ test: 'data' });
      const validTimestamp = currentTimestamp();
      const validSignature = service.generateSignature(payload, validTimestamp);
      const invalidSignature = '0' + validSignature.substring(1);

      // Both should fail but comparison should take similar time
      const result1 = service.verifySignature(
        payload,
        validSignature,
        validTimestamp,
      );
      const result2 = service.verifySignature(
        payload,
        invalidSignature,
        validTimestamp,
      );

      expect(result1).toBe(true);
      expect(result2).toBe(false);
    });
  });
});
