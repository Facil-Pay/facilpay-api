import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, BadRequestException } from '@nestjs/common';
import { WebhookGuard } from './webhook.guard';
import { WebhookSignatureService } from './webhook-signature.service';
import { Request } from 'express';

describe('WebhookGuard', () => {
  let guard: WebhookGuard;
  let signatureService: WebhookSignatureService;

  const mockPayload = JSON.stringify({ paymentId: '123', status: 'COMPLETED' });
  let validSignature: string;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookGuard,
        {
          provide: WebhookSignatureService,
          useValue: {
            verifySignature: jest.fn(),
          },
        },
      ],
    }).compile();

    guard = module.get<WebhookGuard>(WebhookGuard);
    signatureService = module.get<WebhookSignatureService>(
      WebhookSignatureService,
    );

    // Generate valid signature
    validSignature = Buffer.from('valid_signature_hash').toString('hex');
  });

  describe('canActivate', () => {
    it('should throw when X-Signature header is missing', () => {
      const mockRequest = {
        headers: {},
        body: mockPayload,
      } as unknown as Request;

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
        }),
      } as unknown as ExecutionContext;

      expect(() => guard.canActivate(mockContext)).toThrow(BadRequestException);
      expect(() => guard.canActivate(mockContext)).toThrow(
        'Missing X-Signature header',
      );
    });

    it('should throw when signature is invalid', () => {
      const mockRequest = {
        headers: { 'x-signature': 'invalid_signature' },
        body: mockPayload,
      } as unknown as Request;

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
        }),
      } as unknown as ExecutionContext;

      (signatureService.verifySignature as jest.Mock).mockReturnValue(false);

      expect(() => guard.canActivate(mockContext)).toThrow(BadRequestException);
      expect(() => guard.canActivate(mockContext)).toThrow(
        'Invalid webhook signature',
      );
    });

    it('should allow request with valid signature', () => {
      const mockRequest = {
        headers: { 'x-signature': validSignature },
        body: mockPayload,
      } as unknown as Request;

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
        }),
      } as unknown as ExecutionContext;

      (signatureService.verifySignature as jest.Mock).mockReturnValue(true);

      const result = guard.canActivate(mockContext);

      expect(result).toBe(true);
    });

    it('should pass request body to signature verification', () => {
      const customPayload = JSON.stringify({ custom: 'data' });
      const mockRequest = {
        headers: { 'x-signature': validSignature },
        body: customPayload,
      } as unknown as Request;

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
        }),
      } as unknown as ExecutionContext;

      (signatureService.verifySignature as jest.Mock).mockReturnValue(true);

      guard.canActivate(mockContext);

      expect(signatureService.verifySignature).toHaveBeenCalledWith(
        customPayload,
        validSignature,
      );
    });

    it('should handle string body', () => {
      const stringPayload = '{"test":"data"}';
      const mockRequest = {
        headers: { 'x-signature': validSignature },
        body: stringPayload,
      } as unknown as Request;

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
        }),
      } as unknown as ExecutionContext;

      (signatureService.verifySignature as jest.Mock).mockReturnValue(true);

      guard.canActivate(mockContext);

      expect(signatureService.verifySignature).toHaveBeenCalledWith(
        stringPayload,
        validSignature,
      );
    });
  });
});
