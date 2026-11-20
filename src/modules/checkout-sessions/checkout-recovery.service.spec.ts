import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  CheckoutSession,
  CheckoutSessionStatus,
} from './entities/checkout-session.entity';
import { CheckoutRecoveryService } from './checkout-recovery.service';

describe('CheckoutRecoveryService', () => {
  let service: CheckoutRecoveryService;
  let sessionRepo: any;
  let merchantsService: any;
  let prefsService: any;
  let suppressionRepo: any;
  let emailNotificationService: any;
  let configService: any;
  let appLogger: any;

  const now = new Date('2026-11-20T12:00:00.000Z');

  const makeSession = (
    overrides: Partial<CheckoutSession> = {},
  ): CheckoutSession =>
    ({
      id: 'original-session-id',
      publicId: 'originalPublicId1234567890',
      merchantId: 'merchant-1',
      lineItems: [
        { name: 'Widget', quantity: 2, unitAmount: 1500, productId: null },
      ],
      currency: 'USD',
      total: 3000,
      subtotal: 3000,
      discountAmount: 0,
      couponId: null,
      couponCode: null,
      customerId: null,
      customerEmail: 'Buyer@Example.com',
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
      expiresAt: new Date('2026-11-20T10:00:00.000Z'),
      status: CheckoutSessionStatus.EXPIRED,
      paymentId: null,
      recoveryEmailSentAt: null,
      recoveredFromId: null,
      createdAt: new Date('2026-11-20T09:30:00.000Z'),
      updatedAt: new Date('2026-11-20T09:30:00.000Z'),
      ...overrides,
    }) as CheckoutSession;

  beforeEach(() => {
    sessionRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      create: jest.fn((data) => ({ id: 'new-session-id', ...data })),
      save: jest.fn(async (entity) => entity),
    };
    merchantsService = {
      getSettings: jest.fn().mockResolvedValue({
        recoveryEmailsEnabled: true,
        recoveryEmailDelayMinutes: 60,
      }),
      getProfile: jest.fn().mockResolvedValue({ businessName: 'Acme Store' }),
    };
    prefsService = { isEmailEnabled: jest.fn().mockResolvedValue(true) };
    suppressionRepo = { count: jest.fn().mockResolvedValue(0) };
    emailNotificationService = {
      sendCheckoutRecoveryEmail: jest.fn().mockResolvedValue(undefined),
    };
    configService = {
      get: jest.fn((_key: string, fallback: string) => fallback),
    };
    appLogger = {
      child: jest.fn().mockReturnValue({ info: jest.fn(), error: jest.fn() }),
    };

    service = new CheckoutRecoveryService(
      sessionRepo,
      merchantsService,
      prefsService,
      suppressionRepo,
      emailNotificationService,
      configService,
      appLogger,
    );
  });

  describe('sendRecoveryEmails', () => {
    it('sends one recovery email per eligible session and marks it as sent', async () => {
      const session = makeSession();
      sessionRepo.find.mockResolvedValue([session]);

      const sent = await service.sendRecoveryEmails(now);

      expect(sent).toBe(1);
      expect(
        emailNotificationService.sendCheckoutRecoveryEmail,
      ).toHaveBeenCalledTimes(1);
      expect(
        emailNotificationService.sendCheckoutRecoveryEmail,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'buyer@example.com',
          recoveryUrl:
            'https://checkout.facilpay.com/recover/originalPublicId1234567890',
          merchantName: 'Acme Store',
          formattedTotal: '30.00',
          currency: 'USD',
          items: [{ name: 'Widget', quantity: 2 }],
        }),
      );
      expect(sessionRepo.update).toHaveBeenCalledWith(
        { id: 'original-session-id', recoveryEmailSentAt: expect.anything() },
        { recoveryEmailSentAt: now },
      );
    });

    it('does not send when the merchant has not enabled recovery emails', async () => {
      sessionRepo.find.mockResolvedValue([makeSession()]);
      merchantsService.getSettings.mockResolvedValue({
        recoveryEmailsEnabled: false,
        recoveryEmailDelayMinutes: 60,
      });

      await expect(service.sendRecoveryEmails(now)).resolves.toBe(0);
      expect(
        emailNotificationService.sendCheckoutRecoveryEmail,
      ).not.toHaveBeenCalled();
      expect(sessionRepo.update).not.toHaveBeenCalled();
    });

    it('waits for the configured delay after expiry', async () => {
      sessionRepo.find.mockResolvedValue([
        makeSession({ expiresAt: new Date('2026-11-20T11:30:00.000Z') }),
      ]);

      await expect(service.sendRecoveryEmails(now)).resolves.toBe(0);
      expect(
        emailNotificationService.sendCheckoutRecoveryEmail,
      ).not.toHaveBeenCalled();
    });

    it('respects the checkout_recovery notification preference', async () => {
      sessionRepo.find.mockResolvedValue([makeSession()]);
      prefsService.isEmailEnabled.mockResolvedValue(false);

      await expect(service.sendRecoveryEmails(now)).resolves.toBe(0);
      expect(prefsService.isEmailEnabled).toHaveBeenCalledWith(
        'merchant-1',
        'checkout_recovery',
      );
      expect(
        emailNotificationService.sendCheckoutRecoveryEmail,
      ).not.toHaveBeenCalled();
    });

    it('respects unsubscribed addresses', async () => {
      sessionRepo.find.mockResolvedValue([makeSession()]);
      suppressionRepo.count.mockResolvedValue(1);

      await expect(service.sendRecoveryEmails(now)).resolves.toBe(0);
      expect(suppressionRepo.count).toHaveBeenCalledWith({
        where: { email: 'buyer@example.com' },
      });
      expect(
        emailNotificationService.sendCheckoutRecoveryEmail,
      ).not.toHaveBeenCalled();
    });

    it('does not send twice when another process claimed the session', async () => {
      sessionRepo.find.mockResolvedValue([makeSession()]);
      sessionRepo.update.mockResolvedValue({ affected: 0 });

      await expect(service.sendRecoveryEmails(now)).resolves.toBe(0);
      expect(
        emailNotificationService.sendCheckoutRecoveryEmail,
      ).not.toHaveBeenCalled();
    });

    it('only considers expired sessions with an email and no previous recovery email', async () => {
      await service.sendRecoveryEmails(now);

      expect(sessionRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: CheckoutSessionStatus.EXPIRED,
          }),
          take: 100,
        }),
      );
    });
  });

  describe('createRecoverySession', () => {
    it('creates a fresh session with the same line items and a link to the original', async () => {
      sessionRepo.findOne.mockResolvedValue(makeSession());

      const result = await service.createRecoverySession(
        'originalPublicId1234567890',
      );

      expect(result).toEqual(
        expect.objectContaining({
          id: 'new-session-id',
          status: CheckoutSessionStatus.OPEN,
          merchantId: 'merchant-1',
          currency: 'USD',
          total: 3000,
          customerEmail: 'Buyer@Example.com',
          recoveredFromId: 'original-session-id',
        }),
      );
      expect(result.publicId).not.toBe('originalPublicId1234567890');
      expect(result.lineItems).toEqual([
        { name: 'Widget', quantity: 2, unitAmount: 1500, productId: null },
      ]);
      expect(result.recoveryEmailSentAt).toBeNull();
      expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('rejects sessions that are still open', async () => {
      sessionRepo.findOne.mockResolvedValue(
        makeSession({
          status: CheckoutSessionStatus.OPEN,
          expiresAt: new Date('2026-11-20T13:00:00.000Z'),
        }),
      );

      await expect(service.createRecoverySession('unknown')).rejects.toThrow(
        BadRequestException,
      );
      expect(sessionRepo.save).not.toHaveBeenCalled();
    });

    it('rejects sessions without a customer email', async () => {
      sessionRepo.findOne.mockResolvedValue(
        makeSession({ customerEmail: null }),
      );

      await expect(service.createRecoverySession('unknown')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws NotFound for an unknown public id', async () => {
      sessionRepo.findOne.mockResolvedValue(null);

      await expect(service.createRecoverySession('unknown')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
