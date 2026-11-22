import {
  BadRequestException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { CheckoutSessionsService } from './checkout-sessions.service';
import {
  CheckoutSession,
  CheckoutSessionStatus,
} from './entities/checkout-session.entity';
import { CouponsService } from '../coupons/coupons.service';
import { Coupon, CouponType } from '../coupons/coupon.entity';

describe('CheckoutSessionsService coupons', () => {
  const merchantId = 'merchant-1';

  let coupons: Map<string, Coupon>;
  let couponRepo: { findOneBy: jest.Mock; createQueryBuilder: jest.Mock };
  let couponUpdates: Array<{ set: any; where: string[]; params: any }>;
  let redeemAffected: number;
  let couponsService: CouponsService;
  let sessionRepo: { create: jest.Mock; save: jest.Mock; findOne: jest.Mock };
  let storedSession: CheckoutSession | null;
  let paymentsService: { create: jest.Mock };
  let webhooksService: { dispatchEventToMerchant: jest.Mock };
  let service: CheckoutSessionsService;

  const makeCoupon = (overrides: Partial<Coupon>): Coupon =>
    ({
      id: 'coupon-1',
      merchantId,
      code: 'SPRING10',
      type: CouponType.PERCENT,
      value: '10.00',
      currency: null,
      maxRedemptions: null,
      redemptions: 0,
      reservedRedemptions: 0,
      expiresAt: null,
      isActive: true,
      applicableLinkIds: null,
      ...overrides,
    }) as Coupon;

  const baseDto = {
    lineItems: [
      { name: 'Hoodie', quantity: 2, unitAmount: 2500 },
      { name: 'Cap', quantity: 1, unitAmount: 1000 },
    ],
    currency: 'usd',
    successUrl: 'https://example.com/success',
    cancelUrl: 'https://example.com/cancel',
  };

  beforeEach(() => {
    coupons = new Map([
      ['SPRING10', makeCoupon({})],
      ['FIVEOFF', makeCoupon({ id: 'coupon-2', code: 'FIVEOFF', type: CouponType.FIXED, value: '5.00', currency: 'USD' })],
      ['EUROFF', makeCoupon({ id: 'coupon-3', code: 'EUROFF', type: CouponType.FIXED, value: '5.00', currency: 'EUR' })],
      ['HUGE', makeCoupon({ id: 'coupon-4', code: 'HUGE', type: CouponType.FIXED, value: '500.00', currency: 'USD' })],
      ['EXPIRED', makeCoupon({ id: 'coupon-5', code: 'EXPIRED', expiresAt: new Date(Date.now() - 1000) })],
      ['OFF', makeCoupon({ id: 'coupon-6', code: 'OFF', isActive: false })],
      ['USEDUP', makeCoupon({ id: 'coupon-7', code: 'USEDUP', maxRedemptions: 3, redemptions: 2, reservedRedemptions: 1 })],
      ['LINKONLY', makeCoupon({ id: 'coupon-8', code: 'LINKONLY', applicableLinkIds: ['link-1'] })],
    ]);

    couponUpdates = [];
    redeemAffected = 1;
    couponRepo = {
      findOneBy: jest.fn(async ({ merchantId: m, code }) => {
        const coupon = coupons.get(code);
        return coupon && coupon.merchantId === m ? coupon : null;
      }),
      createQueryBuilder: jest.fn(() => {
        const op: { set?: any; where: string[]; params: any } = { where: [], params: {} };
        const qb: any = {
          update: jest.fn(() => qb),
          set: jest.fn((set) => {
            op.set = set;
            return qb;
          }),
          where: jest.fn((clause, params) => {
            op.where.push(clause);
            Object.assign(op.params, params);
            return qb;
          }),
          andWhere: jest.fn((clause, params) => {
            op.where.push(clause);
            Object.assign(op.params, params);
            return qb;
          }),
          execute: jest.fn(async () => {
            couponUpdates.push(op);
            return { affected: redeemAffected };
          }),
        };
        return qb;
      }),
    };
    couponsService = new CouponsService(couponRepo as any);

    storedSession = null;
    sessionRepo = {
      create: jest.fn((data) => ({ ...data })),
      save: jest.fn(async (session) => {
        storedSession = { id: 'session-1', ...session };
        return storedSession;
      }),
      findOne: jest.fn(async () => storedSession),
    };
    paymentsService = { create: jest.fn().mockResolvedValue({ id: 'payment-1' }) };
    webhooksService = { dispatchEventToMerchant: jest.fn().mockResolvedValue(undefined) };

    service = new CheckoutSessionsService(
      sessionRepo as any,
      {
        getBrandingWithDefaults: jest.fn().mockResolvedValue({
          displayName: 'Store',
          logo: null,
          primaryColor: '#000',
        }),
      } as any,
      webhooksService as any,
      paymentsService as any,
      {} as any,
      { get: jest.fn((_key, fallback) => fallback) } as any,
      { child: () => ({ info: jest.fn(), error: jest.fn() }) } as any,
      couponsService,
    );
  });

  const redemptionUpdates = () =>
    couponUpdates.filter((u) => typeof u.set?.redemptions === 'function');

  describe('create', () => {
    it('applies a percent coupon and recomputes totals', async () => {
      const session = await service.create(merchantId, { ...baseDto, couponCode: ' spring10 ' });

      expect(session.subtotal).toBe(6000);
      expect(session.discountAmount).toBe(600);
      expect(session.total).toBe(5400);
      expect(session.couponId).toBe('coupon-1');
      expect(session.couponCode).toBe('SPRING10');
    });

    it('applies a fixed coupon converting major units to minor units', async () => {
      const session = await service.create(merchantId, { ...baseDto, couponCode: 'FIVEOFF' });

      expect(session.discountAmount).toBe(500);
      expect(session.total).toBe(5500);
    });

    it('rounds percent discounts to the nearest minor unit', async () => {
      coupons.set('THIRD', makeCoupon({ code: 'THIRD', value: '33.33' }));

      const session = await service.create(merchantId, {
        ...baseDto,
        lineItems: [{ name: 'Item', quantity: 1, unitAmount: 999 }],
        couponCode: 'THIRD',
      });

      expect(session.discountAmount).toBe(333);
      expect(session.total).toBe(666);
    });

    it('leaves totals untouched without a coupon', async () => {
      const session = await service.create(merchantId, baseDto);

      expect(session.subtotal).toBe(6000);
      expect(session.total).toBe(6000);
      expect(session.discountAmount).toBe(0);
      expect(session.couponId).toBeNull();
    });

    it('does not count a redemption when the session is created', async () => {
      await service.create(merchantId, { ...baseDto, couponCode: 'SPRING10' });

      expect(couponUpdates).toHaveLength(0);
    });

    it.each([
      ['UNKNOWN', 'Coupon is invalid or inactive'],
      ['OFF', 'Coupon is invalid or inactive'],
      ['EXPIRED', 'Coupon has expired'],
      ['USEDUP', 'Coupon redemption limit reached'],
      ['EUROFF', 'Coupon currency does not match payment currency'],
      ['LINKONLY', 'Coupon is restricted to specific payment links'],
      ['HUGE', 'Coupon discount cannot cover the full session amount'],
    ])('rejects coupon %s', async (couponCode, message) => {
      await expect(
        service.create(merchantId, { ...baseDto, couponCode }),
      ).rejects.toThrow(new UnprocessableEntityException(message));
      expect(sessionRepo.save).not.toHaveBeenCalled();
    });

    it("rejects another merchant's coupon", async () => {
      await expect(
        service.create('merchant-2', { ...baseDto, couponCode: 'SPRING10' }),
      ).rejects.toThrow('Coupon is invalid or inactive');
    });
  });

  describe('public apply / remove', () => {
    beforeEach(async () => {
      await service.create(merchantId, baseDto);
      storedSession!.publicId = 'pub-1';
    });

    it('applies a coupon to an open session', async () => {
      const session = await service.applyCoupon('pub-1', 'FIVEOFF');

      expect(session.total).toBe(5500);
      expect(session.discountAmount).toBe(500);
      expect(session.couponCode).toBe('FIVEOFF');
      expect(redemptionUpdates()).toHaveLength(0);
    });

    it('replaces a previously applied coupon based on the original subtotal', async () => {
      await service.applyCoupon('pub-1', 'SPRING10');
      const session = await service.applyCoupon('pub-1', 'FIVEOFF');

      expect(session.subtotal).toBe(6000);
      expect(session.total).toBe(5500);
      expect(session.couponId).toBe('coupon-2');
    });

    it('removes a coupon and restores the subtotal', async () => {
      await service.applyCoupon('pub-1', 'SPRING10');
      const session = await service.removeCoupon('pub-1');

      expect(session.total).toBe(6000);
      expect(session.discountAmount).toBe(0);
      expect(session.couponId).toBeNull();
      expect(session.couponCode).toBeNull();
    });

    it('rejects an expired coupon', async () => {
      await expect(service.applyCoupon('pub-1', 'EXPIRED')).rejects.toThrow(
        'Coupon has expired',
      );
    });

    it('rejects coupons on sessions that are not open', async () => {
      storedSession!.status = CheckoutSessionStatus.COMPLETE;

      await expect(service.applyCoupon('pub-1', 'SPRING10')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('completeSession', () => {
    beforeEach(async () => {
      await service.create(merchantId, { ...baseDto, couponCode: 'SPRING10' });
      storedSession!.publicId = 'pub-1';
    });

    it('charges the discounted total and counts one redemption', async () => {
      await service.completeSession('pub-1', 'payer@example.com');

      expect(paymentsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 54,
          metadata: expect.objectContaining({
            couponId: 'coupon-1',
            couponCode: 'SPRING10',
            discountAmount: '600',
          }),
        }),
      );

      const redemptions = redemptionUpdates();
      expect(redemptions).toHaveLength(1);
      expect(redemptions[0].set.redemptions()).toBe('"redemptions" + 1');
      expect(redemptions[0].params).toEqual({ couponId: 'coupon-1' });
      expect(redemptions[0].where).toEqual(
        expect.arrayContaining([
          '"isActive" = true',
          '("expiresAt" IS NULL OR "expiresAt" > now())',
        ]),
      );
    });

    it('rejects completion when the coupon is no longer valid', async () => {
      redeemAffected = 0;

      await expect(
        service.completeSession('pub-1', 'payer@example.com'),
      ).rejects.toThrow('Coupon is no longer valid');
      expect(paymentsService.create).not.toHaveBeenCalled();
      expect(storedSession!.status).toBe(CheckoutSessionStatus.OPEN);
    });

    it('releases the redemption when payment creation fails', async () => {
      paymentsService.create.mockRejectedValueOnce(new Error('stellar down'));

      await expect(
        service.completeSession('pub-1', 'payer@example.com'),
      ).rejects.toThrow('stellar down');

      expect(couponUpdates).toHaveLength(2);
      expect(couponUpdates[1].set.redemptions()).toBe('"redemptions" - 1');
    });

    it('does not touch coupons for sessions without one', async () => {
      await service.removeCoupon('pub-1');

      await service.completeSession('pub-1', 'payer@example.com');

      expect(couponUpdates).toHaveLength(0);
      expect(paymentsService.create).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 60 }),
      );
    });
  });
});
