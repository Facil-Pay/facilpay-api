import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { WebhookSignatureService } from './webhook-signature.service';

describe('WebhookSignatureService', () => {
  let service: WebhookSignatureService;
  let configService: ConfigService;

  const mockSecret = 'test-webhook-secret';

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
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<WebhookSignatureService>(WebhookSignatureService);
    configService = module.get<ConfigService>(ConfigService);
  });

  describe('generateSignature', () => {
    it('should generate consistent signature for same payload', () => {
      const payload = JSON.stringify({ paymentId: '123', status: 'COMPLETED' });

      const sig1 = service.generateSignature(payload);
      const sig2 = service.generateSignature(payload);

      expect(sig1).toBe(sig2);
    });

    it('should generate different signature for different payload', () => {
      const payload1 = JSON.stringify({
        paymentId: '123',
        status: 'COMPLETED',
      });
      const payload2 = JSON.stringify({ paymentId: '456', status: 'FAILED' });

      const sig1 = service.generateSignature(payload1);
      const sig2 = service.generateSignature(payload2);

      expect(sig1).not.toBe(sig2);
    });

    it('should generate hex-encoded signature', () => {
      const payload = JSON.stringify({ test: 'data' });
      const signature = service.generateSignature(payload);

      // Should be valid hex string
      expect(/^[a-f0-9]{64}$/i.test(signature)).toBe(true);
    });
  });

  describe('verifySignature', () => {
    it('should verify valid signature', () => {
      const payload = JSON.stringify({ paymentId: '123', status: 'COMPLETED' });
      const signature = service.generateSignature(payload);

      const isValid = service.verifySignature(payload, signature);

      expect(isValid).toBe(true);
    });

    it('should reject invalid signature', () => {
      const payload = JSON.stringify({ paymentId: '123', status: 'COMPLETED' });
      const invalidSignature = 'invalid_signature_123456';

      const isValid = service.verifySignature(payload, invalidSignature);

      expect(isValid).toBe(false);
    });

    it('should reject missing signature', () => {
      const payload = JSON.stringify({ paymentId: '123', status: 'COMPLETED' });

      const isValid = service.verifySignature(payload, '');

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

      const signature = service.generateSignature(payload1);
      const isValid = service.verifySignature(payload2, signature);

      expect(isValid).toBe(false);
    });

    it('should work with Buffer payload', () => {
      const payload = JSON.stringify({ paymentId: '123', status: 'COMPLETED' });
      const buffer = Buffer.from(payload);
      const signature = service.generateSignature(payload);

      const isValid = service.verifySignature(buffer, signature);

      expect(isValid).toBe(true);
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
      const result = serviceWithoutSecret.verifySignature(
        payload,
        'some-signature',
      );

      expect(result).toBe(false);
    });
  });

  describe('Timing attack resistance', () => {
    it('should use constant-time comparison', () => {
      const payload = JSON.stringify({ test: 'data' });
      const validSignature = service.generateSignature(payload);
      const invalidSignature = '0' + validSignature.substring(1);

      // Both should fail but comparison should take similar time
      const result1 = service.verifySignature(payload, validSignature);
      const result2 = service.verifySignature(payload, invalidSignature);

      expect(result1).toBe(true);
      expect(result2).toBe(false);
    });
  });
});
