jest.mock('../../tracing', () => ({
  getTraceId: jest.fn(),
  initializeTracing: jest.fn(),
  runWithTrace: (_name: string, fn: () => unknown) => fn(),
}));
jest.mock('../payments/payments.service', () => ({
  PaymentsService: class PaymentsService {},
}));

import {
  BadRequestException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import {
  CheckoutSession,
  CheckoutSessionStatus,
} from './entities/checkout-session.entity';
import { CheckoutSessionsService } from './checkout-sessions.service';
import { CheckoutSessionsPublicController } from './checkout-sessions.controller';

describe('CheckoutSessionsService', () => {
  let service: CheckoutSessionsService;
  let publicController: CheckoutSessionsPublicController;
  let sessionRepo: any;
  let merchantsService: any;
  let webhooksService: any;
  let paymentsService: any;
  let productsService: any;
  let configService: any;
  let appLogger: any;
  let couponsService: any;

  const makeSession = (
    overrides: Partial<CheckoutSession> = {},
  ): CheckoutSession =>
    ({
      id: 'session-id',
      publicId: 'pub-id-1234567890ab',
      merchantId: 'merchant-1',
      lineItems: [
        { name: 'Item', quantity: 1, unitAmount: 1000, productId: null },
      ],
      currency: 'USD',
      subtotal: 1000,
      discountAmount: 0,
      total: 1000,
      couponId: null,
      couponCode: null,
      customerId: 'cust-internal-1',
      customerEmail: 'secret@example.com',
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      status: CheckoutSessionStatus.OPEN,
      paymentId: 'pay-internal-1',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      ...overrides,
    }) as CheckoutSession;

  beforeEach(() => {
    sessionRepo = {
      create: jest.fn((data) => ({ id: 'session-id', ...data })),
      save: jest.fn(async (entity) => entity),
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
      createQueryBuilder: jest.fn(),
    };
    merchantsService = {
      getBrandingWithDefaults: jest.fn().mockResolvedValue({
        displayName: 'Test Merchant',
        logo: 'https://cdn.example.com/logo.png',
        primaryColor: '#123456',
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
    couponsService = {
      validateForCheckoutSession: jest.fn(),
      redeem: jest.fn(),
      releaseRedemption: jest.fn(),
    };

    service = new CheckoutSessionsService(
      sessionRepo,
      merchantsService,
      webhooksService,
      paymentsService,
      productsService,
      configService,
      appLogger,
      couponsService,
    );
    publicController = new CheckoutSessionsPublicController(service);
  });

  // ── create tests ────────────────────────────────────────────────────────

  describe('create', () => {
    it('computes subtotal/total from inline line items, uppercases currency, and sets default 30m expiry', async () => {
      const before = Date.now();
      const created = await service.create('merchant-1', {
        lineItems: [
          { name: 'Pro Plan', description: 'Monthly', quantity: 2, unitAmount: 1500 },
          { name: 'Add-on', quantity: 3, unitAmount: 500 },
        ],
        currency: 'usdc',
        successUrl: 'https://example.com/ok',
        cancelUrl: 'https://example.com/cancel',
      });

      expect(created.merchantId).toBe('merchant-1');
      expect(created.currency).toBe('USDC');
      expect(created.subtotal).toBe(4500);
      expect(created.total).toBe(4500);
      expect(created.discountAmount).toBe(0);
      expect(created.status).toBe(CheckoutSessionStatus.OPEN);
      expect(created.publicId).toHaveLength(22);
      expect(created.expiresAt.getTime()).toBeGreaterThanOrEqual(
        before + 29 * 60 * 1000,
      );
    });

    it('resolves catalog products via ProductsService.validateAndGetProduct and validates currency', async () => {
      productsService.validateAndGetProduct.mockResolvedValue({
        id: 'prod-1',
        name: 'Catalog Item',
        description: 'From catalog',
        unitAmount: '19.99',
        currency: 'USD',
      });

      const created = await service.create('merchant-1', {
        lineItems: [{ productId: 'prod-1', quantity: 2 }],
        currency: 'usd',
        expiresInMinutes: 60,
        customerId: 'cust-1',
        customerEmail: 'buyer@example.com',
        successUrl: 'https://example.com/ok',
        cancelUrl: 'https://example.com/cancel',
      });

      expect(productsService.validateAndGetProduct).toHaveBeenCalledWith(
        'merchant-1',
        'prod-1',
        'usd',
      );
      expect(created.lineItems).toEqual([
        {
          productId: 'prod-1',
          name: 'Catalog Item',
          description: 'From catalog',
          quantity: 2,
          unitAmount: 1999,
        },
      ]);
      expect(created.total).toBe(3998);
      expect(created.customerId).toBe('cust-1');
      expect(created.customerEmail).toBe('buyer@example.com');
    });

    it('propagates currency mismatch errors from ProductsService.validateAndGetProduct', async () => {
      productsService.validateAndGetProduct.mockRejectedValue(
        new BadRequestException('Product currency EUR does not match session currency USD'),
      );

      await expect(
        service.create('merchant-1', {
          lineItems: [{ productId: 'prod-eur', quantity: 1 }],
          currency: 'USD',
          successUrl: 'https://example.com/ok',
          cancelUrl: 'https://example.com/cancel',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(sessionRepo.save).not.toHaveBeenCalled();
    });

    it('rejects empty lineItems array with BadRequestException', async () => {
      await expect(
        service.create('merchant-1', {
          lineItems: [],
          currency: 'USD',
          successUrl: 'https://example.com/ok',
          cancelUrl: 'https://example.com/cancel',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects line item without productId when name or unitAmount is missing', async () => {
      await expect(
        service.create('merchant-1', {
          lineItems: [{ quantity: 1, unitAmount: 500 }],
          currency: 'USD',
          successUrl: 'https://example.com/ok',
          cancelUrl: 'https://example.com/cancel',
        }),
      ).rejects.toThrow(
        'Line items must provide productId or both name and unitAmount',
      );

      await expect(
        service.create('merchant-1', {
          lineItems: [{ name: 'No Price', quantity: 1 }],
          currency: 'USD',
          successUrl: 'https://example.com/ok',
          cancelUrl: 'https://example.com/cancel',
        }),
      ).rejects.toThrow(
        'Line items must provide productId or both name and unitAmount',
      );
    });
  });

  // ── expire & webhook dispatch tests ─────────────────────────────────────

  describe('expire and webhook dispatch', () => {
    it('marks an OPEN session EXPIRED and dispatches checkout.session.expired', async () => {
      const session = makeSession({ status: CheckoutSessionStatus.OPEN });
      sessionRepo.findOne.mockResolvedValue(session);
      sessionRepo.save.mockResolvedValue({
        ...session,
        status: CheckoutSessionStatus.EXPIRED,
      });

      const result = await service.expire('session-id', 'merchant-1');

      expect(result.status).toBe(CheckoutSessionStatus.EXPIRED);
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

    it('is idempotent when expiring an already EXPIRED session (no save or duplicate webhook)', async () => {
      const expired = makeSession({ status: CheckoutSessionStatus.EXPIRED });
      sessionRepo.findOne.mockResolvedValue(expired);

      const result = await service.expire('session-id', 'merchant-1');

      expect(result.status).toBe(CheckoutSessionStatus.EXPIRED);
      expect(sessionRepo.save).not.toHaveBeenCalled();
      expect(webhooksService.dispatchEventToMerchant).not.toHaveBeenCalled();
    });

    it('rejects expiring a COMPLETE session with BadRequestException and does not dispatch', async () => {
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

      const result = await service.completeSession(
        'pub-id-1234567890ab',
        'buyer@example.com',
      );

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
      const session = makeSession({ status: CheckoutSessionStatus.COMPLETE });
      sessionRepo.findOne.mockResolvedValue(session);

      await expect(
        service.completeSession('pub-id-1234567890ab', 'buyer@example.com'),
      ).rejects.toThrow(BadRequestException);

      expect(webhooksService.dispatchEventToMerchant).not.toHaveBeenCalled();
    });

    it('dispatches checkout.session.expired for each stale session in the cron job', async () => {
      const stale1 = makeSession({
        id: 's1',
        merchantId: 'merchant-a',
        publicId: 'pub1',
        expiresAt: new Date(Date.now() - 60_000),
      });
      const stale2 = makeSession({
        id: 's2',
        merchantId: 'merchant-b',
        publicId: 'pub2',
        expiresAt: new Date(Date.now() - 60_000),
      });
      const fresh = makeSession({
        id: 's3',
        merchantId: 'merchant-c',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
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

  // ── Merchant scoping on get and list ────────────────────────────────────

  describe('merchant scoping on findById and findAll', () => {
    it('scopes findById query to { id, merchantId } and returns owned session', async () => {
      const session = makeSession();
      sessionRepo.findOne.mockResolvedValue(session);

      const result = await service.findById('session-id', 'merchant-1');
      expect(result.id).toBe('session-id');
      expect(sessionRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'session-id', merchantId: 'merchant-1' },
      });
    });

    it('throws NotFoundException when another merchant requests the session', async () => {
      sessionRepo.findOne.mockResolvedValue(null);

      await expect(
        service.findById('session-id', 'merchant-other'),
      ).rejects.toThrow(NotFoundException);
      expect(sessionRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'session-id', merchantId: 'merchant-other' },
      });
    });

    it('scopes findAll to the authenticated merchantId with pagination defaults and overrides', async () => {
      const s1 = makeSession({ id: 's1', merchantId: 'merchant-1' });
      sessionRepo.findAndCount.mockResolvedValue([[s1], 1]);

      const res = await service.findAll('merchant-1', { limit: 10, offset: 5 });

      expect(res).toEqual({ sessions: [s1], total: 1 });
      expect(sessionRepo.findAndCount).toHaveBeenCalledWith({
        where: { merchantId: 'merchant-1' },
        order: { createdAt: 'DESC' },
        take: 10,
        skip: 5,
      });
    });
  });

  // ── Public view & internal field hiding ─────────────────────────────────

  describe('getPublicSession and public view serialization', () => {
    it('throws GoneException when the session status is EXPIRED', async () => {
      const session = makeSession({
        status: CheckoutSessionStatus.EXPIRED,
        expiresAt: new Date(Date.now() - 10000),
      });
      sessionRepo.findOne.mockResolvedValue(session);

      await expect(service.getPublicSession('pub-id')).rejects.toThrow(
        GoneException,
      );
    });

    it('throws GoneException when an OPEN session has passed its expiresAt timestamp', async () => {
      const session = makeSession({
        status: CheckoutSessionStatus.OPEN,
        expiresAt: new Date(Date.now() - 10000),
      });
      sessionRepo.findOne.mockResolvedValue(session);

      await expect(service.getPublicSession('pub-id')).rejects.toThrow(
        GoneException,
      );
    });

    it('hides internal fields (id, merchantId, paymentId, customerId, customerEmail, couponId) in public view', async () => {
      const session = makeSession({
        id: 'internal-uuid-999',
        merchantId: 'secret-merchant-uuid',
        paymentId: 'secret-payment-uuid',
        customerId: 'secret-customer-uuid',
        customerEmail: 'private@customer.com',
        couponId: 'secret-coupon-uuid',
        couponCode: 'SAVE10',
        subtotal: 2000,
        discountAmount: 200,
        total: 1800,
      });
      sessionRepo.findOne.mockResolvedValue(session);

      const publicView = (await publicController.getPublic(
        'pub-id-1234567890ab',
      )) as Record<string, unknown>;

      expect(publicView).toEqual({
        merchantDisplayName: 'Test Merchant',
        merchantLogo: 'https://cdn.example.com/logo.png',
        primaryColor: '#123456',
        lineItems: session.lineItems,
        subtotalFormatted: 'USD 20.00',
        discountFormatted: 'USD 2.00',
        couponCode: 'SAVE10',
        totalFormatted: 'USD 18.00',
        status: CheckoutSessionStatus.OPEN,
        isExpired: false,
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
      });

      expect(publicView).not.toHaveProperty('id');
      expect(publicView).not.toHaveProperty('merchantId');
      expect(publicView).not.toHaveProperty('paymentId');
      expect(publicView).not.toHaveProperty('customerId');
      expect(publicView).not.toHaveProperty('customerEmail');
      expect(publicView).not.toHaveProperty('couponId');
    });
  });
});
