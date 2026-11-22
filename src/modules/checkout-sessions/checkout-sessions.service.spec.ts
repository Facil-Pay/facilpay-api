import { BadRequestException, GoneException, NotFoundException } from '@nestjs/common';
import { CheckoutSession, CheckoutSessionStatus } from './entities/checkout-session.entity';
import { CheckoutSessionsService } from './checkout-sessions.service';

describe('CheckoutSessionsService', () => {
  let service: CheckoutSessionsService;
  let sessionRepo: any;
  let merchantsService: any;
  let webhooksService: any;
  let paymentsService: any;
  let productsService: any;
  let configService: any;
  let appLogger: any;

  const makeSession = (overrides: Partial<CheckoutSession> = {}): CheckoutSession => ({
    id: 'session-id',
    publicId: 'pub-id-1234567890ab',
    merchantId: 'merchant-1',
    lineItems: [{ name: 'Item', quantity: 1, unitAmount: 1000, productId: null }],
    currency: 'USD',
    total: 1000,
    customerId: null,
    customerEmail: null,
    successUrl: 'https://example.com/success',
    cancelUrl: 'https://example.com/cancel',
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    status: CheckoutSessionStatus.OPEN,
    paymentId: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  }) as CheckoutSession;

  beforeEach(() => {
    sessionRepo = {
      create: jest.fn((data) => data),
      save: jest.fn(async (entity) => entity),
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
      createQueryBuilder: jest.fn(),
    };
    merchantsService = {
      getBrandingWithDefaults: jest.fn().mockResolvedValue({
        displayName: 'Test Merchant',
        logo: null,
        primaryColor: '#000000',
      }),
    };
    webhooksService = {
      dispatchEventToMerchant: jest.fn().mockResolvedValue(undefined),
    };
    paymentsService = {
      create: jest.fn().mockResolvedValue({ id: 'payment-id' }),
    };
    productsService = {
      validateAndGetProduct: jest.fn(),
    };
    configService = {
      get: jest.fn().mockReturnValue('https://checkout.facilpay.com'),
    };
    appLogger = {
      child: jest.fn().mockReturnValue({
        info: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
      }),
    };

    service = new CheckoutSessionsService(
      sessionRepo,
      merchantsService,
      webhooksService,
      paymentsService,
      productsService,
      configService,
      appLogger,
    );
  });

  // ── Webhook dispatch tests ──────────────────────────────────────────────

  describe('webhook dispatch', () => {
    it('dispatches checkout.session.expired when a session is expired manually', async () => {
      const session = makeSession({ status: CheckoutSessionStatus.OPEN });
      sessionRepo.findOne.mockResolvedValue(session);
      sessionRepo.save.mockResolvedValue({ ...session, status: CheckoutSessionStatus.EXPIRED });

      await service.expire('session-id', 'merchant-1');

      expect(webhooksService.dispatchEventToMerchant).toHaveBeenCalledTimes(1);
      expect(webhooksService.dispatchEventToMerchant).toHaveBeenCalledWith(
        'merchant-1',
        'checkout.session.expired',
        expect.objectContaining({
          sessionId: 'session-id',
          publicId: 'pub-id-1234567890ab',
        }),
      );
    });

    it('rejects expiring a non-open session and does not dispatch', async () => {
      const session = makeSession({ status: CheckoutSessionStatus.COMPLETE });
      sessionRepo.findOne.mockResolvedValue(session);

      await expect(service.expire('session-id', 'merchant-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(webhooksService.dispatchEventToMerchant).not.toHaveBeenCalled();
    });

    it('dispatches checkout.session.completed when a session is completed', async () => {
      const session = makeSession({ status: CheckoutSessionStatus.OPEN });
      sessionRepo.findOne.mockResolvedValue(session);
      paymentsService.create.mockResolvedValue({ id: 'pay-123' });

      const result = await service.completeSession('pub-id-1234567890ab', 'buyer@example.com');

      expect(result.payment.id).toBe('pay-123');
      expect(webhooksService.dispatchEventToMerchant).toHaveBeenCalledTimes(1);
      expect(webhooksService.dispatchEventToMerchant).toHaveBeenCalledWith(
        'merchant-1',
        'checkout.session.completed',
        expect.objectContaining({
          sessionId: 'session-id',
          publicId: 'pub-id-1234567890ab',
          paymentId: 'pay-123',
          customerEmail: 'buyer@example.com',
        }),
      );
    });

    it('does not dispatch checkout.session.completed when session is not open', async () => {
      const session = makeSession({ status: CheckoutSessionStatus.EXPIRED });
      sessionRepo.findOne.mockResolvedValue(session);

      await expect(
        service.completeSession('pub-id-1234567890ab', 'buyer@example.com'),
      ).rejects.toThrow(BadRequestException);

      expect(webhooksService.dispatchEventToMerchant).not.toHaveBeenCalled();
    });

    it('dispatches checkout.session.expired for each stale session in the cron job', async () => {
      const stale1 = makeSession({ id: 's1', merchantId: 'merchant-a', publicId: 'pub1' });
      const stale2 = makeSession({ id: 's2', merchantId: 'merchant-b', publicId: 'pub2' });
      const fresh = makeSession({
        id: 's3',
        merchantId: 'merchant-c',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour in the future
      });

      sessionRepo.find.mockResolvedValue([stale1, stale2, fresh]);

      const builder: any = {};
      builder.update = jest.fn().mockReturnValue(builder);
      builder.set = jest.fn().mockReturnValue(builder);
      builder.where = jest.fn().mockReturnValue(builder);
      builder.andWhere = jest.fn().mockReturnValue(builder);
      builder.execute = jest.fn().mockResolvedValue({ affected: 2 });
      sessionRepo.createQueryBuilder.mockReturnValue(builder);

      const affected = await service.expireStaleSessions();

      expect(affected).toBe(2);
      expect(webhooksService.dispatchEventToMerchant).toHaveBeenCalledTimes(2);
      expect(webhooksService.dispatchEventToMerchant).toHaveBeenCalledWith(
        'merchant-a',
        'checkout.session.expired',
        expect.objectContaining({ sessionId: 's1' }),
      );
      expect(webhooksService.dispatchEventToMerchant).toHaveBeenCalledWith(
        'merchant-b',
        'checkout.session.expired',
        expect.objectContaining({ sessionId: 's2' }),
      );
    });

    it('does not dispatch when no sessions are stale', async () => {
      sessionRepo.find.mockResolvedValue([]);

      const builder: any = {};
      builder.update = jest.fn().mockReturnValue(builder);
      builder.set = jest.fn().mockReturnValue(builder);
      builder.where = jest.fn().mockReturnValue(builder);
      builder.andWhere = jest.fn().mockReturnValue(builder);
      builder.execute = jest.fn().mockResolvedValue({ affected: 0 });
      sessionRepo.createQueryBuilder.mockReturnValue(builder);

      const affected = await service.expireStaleSessions();

      expect(affected).toBe(0);
      expect(webhooksService.dispatchEventToMerchant).not.toHaveBeenCalled();
    });
  });

  // ── Basic service tests ─────────────────────────────────────────────────

  describe('findById', () => {
    it('returns the session when it belongs to the merchant', async () => {
      const session = makeSession();
      sessionRepo.findOne.mockResolvedValue(session);

      const result = await service.findById('session-id', 'merchant-1');
      expect(result.id).toBe('session-id');
    });

    it('throws NotFound when session does not exist', async () => {
      sessionRepo.findOne.mockResolvedValue(null);

      await expect(service.findById('missing', 'merchant-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getPublicSession', () => {
    it('throws Gone when the session is expired', async () => {
      const session = makeSession({
        status: CheckoutSessionStatus.EXPIRED,
        expiresAt: new Date(Date.now() - 10000),
      });
      sessionRepo.findOne.mockResolvedValue(session);

      await expect(service.getPublicSession('pub-id')).rejects.toThrow(GoneException);
    });

    it('throws Gone when an open session has passed its expiry', async () => {
      const session = makeSession({
        status: CheckoutSessionStatus.OPEN,
        expiresAt: new Date(Date.now() - 10000),
      });
      sessionRepo.findOne.mockResolvedValue(session);

      await expect(service.getPublicSession('pub-id')).rejects.toThrow(GoneException);
    });
  });
});
