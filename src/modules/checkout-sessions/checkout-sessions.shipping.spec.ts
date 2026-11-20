/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/require-await */
import { BadRequestException } from '@nestjs/common';
import { CheckoutSessionsService } from './checkout-sessions.service';
import {
  CheckoutSession,
  CheckoutSessionStatus,
  ShippingAddress,
} from './entities/checkout-session.entity';
import { CouponType } from '../coupons/coupon.entity';

describe('CheckoutSessionsService shipping', () => {
  const merchantId = 'merchant-1';
  const shippingAddress: ShippingAddress = {
    name: 'Jane Doe',
    line1: '123 Main St',
    city: 'New York',
    state: 'NY',
    postalCode: '10001',
    country: 'US',
  };

  let service: CheckoutSessionsService;
  let sessionRepo: { create: jest.Mock; save: jest.Mock; findOne: jest.Mock };
  let paymentsService: { create: jest.Mock };
  let webhooksService: { dispatchEventToMerchant: jest.Mock };
  let couponsService: {
    validateForCheckoutSession: jest.Mock;
    redeem: jest.Mock;
  };
  let customerRepo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let storedSession: CheckoutSession | null;

  const baseDto = () => ({
    lineItems: [{ name: 'Hoodie', quantity: 2, unitAmount: 2500 }],
    currency: 'USD',
    successUrl: 'https://example.com/success',
    cancelUrl: 'https://example.com/cancel',
  });

  const makeSession = (
    overrides: Partial<CheckoutSession> = {},
  ): CheckoutSession =>
    ({
      id: 'session-1',
      publicId: 'pub-1234567890',
      merchantId,
      lineItems: [
        { name: 'Hoodie', quantity: 1, unitAmount: 5000, productId: null },
      ],
      currency: 'USD',
      total: 5000,
      subtotal: 5000,
      discountAmount: 0,
      shippingAddressCollection: { allowedCountries: ['US', 'CA'] },
      shippingOptions: [{ id: 'standard', label: 'Standard', amount: 500 }],
      shippingAddress: null,
      shippingOptionId: null,
      shippingAmount: 0,
      couponId: null,
      couponCode: null,
      customerId: null,
      customerEmail: null,
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      status: CheckoutSessionStatus.OPEN,
      paymentId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    }) as CheckoutSession;

  beforeEach(() => {
    storedSession = null;
    sessionRepo = {
      create: jest.fn((data) => data),
      save: jest.fn(async (entity) => {
        storedSession = entity;
        return entity;
      }),
      findOne: jest.fn(async () => storedSession),
    };
    paymentsService = {
      create: jest.fn().mockResolvedValue({ id: 'payment-1' }),
    };
    webhooksService = {
      dispatchEventToMerchant: jest.fn().mockResolvedValue(undefined),
    };
    couponsService = {
      validateForCheckoutSession: jest.fn().mockResolvedValue({
        id: 'coupon-1',
        code: 'FIVEOFF',
        type: CouponType.FIXED,
        value: '5.00',
      }),
      redeem: jest.fn().mockResolvedValue(undefined),
    };
    customerRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((data) => ({ id: 'customer-1', ...data })),
      save: jest.fn(async (entity) => entity),
    };

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
      {
        child: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }),
      } as any,
      couponsService as any,
      customerRepo as any,
    );
  });

  describe('create with shipping configuration', () => {
    it('stores the collection config and adds a preselected rate to the total', async () => {
      const session = await service.create(merchantId, {
        ...baseDto(),
        shippingAddressCollection: { allowedCountries: ['us', 'ca'] },
        shippingOptions: [{ id: 'standard', label: 'Standard', amount: 500 }],
        shippingOptionId: 'standard',
      } as any);

      expect(session.shippingAddressCollection).toEqual({
        allowedCountries: ['US', 'CA'],
      });
      expect(session.shippingOptions).toEqual([
        { id: 'standard', label: 'Standard', amount: 500 },
      ]);
      expect(session.shippingAmount).toBe(500);
      expect(session.total).toBe(5500);
      expect(session.shippingAddress).toBeNull();
    });

    it('rejects a non ISO 3166-1 alpha-2 allowed country', async () => {
      await expect(
        service.create(merchantId, {
          ...baseDto(),
          shippingAddressCollection: { allowedCountries: ['USA'] },
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects duplicate and negative shipping options', async () => {
      await expect(
        service.create(merchantId, {
          ...baseDto(),
          shippingOptions: [
            { id: 'a', label: 'A', amount: 100 },
            { id: 'a', label: 'B', amount: 200 },
          ],
        } as any),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.create(merchantId, {
          ...baseDto(),
          shippingOptions: [{ id: 'a', label: 'A', amount: -1 }],
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an unknown preselected shipping option', async () => {
      await expect(
        service.create(merchantId, {
          ...baseDto(),
          shippingOptions: [{ id: 'a', label: 'A', amount: 100 }],
          shippingOptionId: 'missing',
        } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('submitShippingAddress', () => {
    it('rejects sessions that do not collect an address', async () => {
      storedSession = makeSession({ shippingAddressCollection: null });
      await expect(
        service.submitShippingAddress('pub-1234567890', {
          shippingAddress,
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('requires the mandatory address fields', async () => {
      storedSession = makeSession();
      await expect(
        service.submitShippingAddress('pub-1234567890', {
          shippingAddress: { ...shippingAddress, city: '' },
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an invalid country code', async () => {
      storedSession = makeSession();
      await expect(
        service.submitShippingAddress('pub-1234567890', {
          shippingAddress: { ...shippingAddress, country: 'USA' },
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects countries outside the merchant allowlist', async () => {
      storedSession = makeSession();
      await expect(
        service.submitShippingAddress('pub-1234567890', {
          shippingAddress: { ...shippingAddress, country: 'FR' },
        } as any),
      ).rejects.toThrow(/not allowed/);
    });

    it('rejects an unknown shipping option and requires a selection', async () => {
      storedSession = makeSession();
      await expect(
        service.submitShippingAddress('pub-1234567890', {
          shippingAddress,
          shippingOptionId: 'express',
        } as any),
      ).rejects.toThrow(BadRequestException);
      expect(storedSession.shippingAddress).toBeNull();

      await expect(
        service.submitShippingAddress('pub-1234567890', {
          shippingAddress,
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('stores the address and adds the selected rate to the total', async () => {
      storedSession = makeSession({
        shippingOptions: [
          { id: 'standard', label: 'Standard', amount: 500 },
          { id: 'express', label: 'Express', amount: 1200 },
        ],
      });

      const result = await service.submitShippingAddress('pub-1234567890', {
        shippingAddress,
        shippingOptionId: 'express',
      } as any);

      expect(result.shippingAddress).toEqual(shippingAddress);
      expect(result.shippingOptionId).toBe('express');
      expect(result.shippingAmount).toBe(1200);
      expect(result.total).toBe(6200);
      expect(customerRepo.save).not.toHaveBeenCalled();
    });

    it('accepts an empty allowlist and normalizes the address', async () => {
      storedSession = makeSession({
        shippingAddressCollection: { allowedCountries: [] },
        shippingOptions: [],
      });

      const result = await service.submitShippingAddress('pub-1234567890', {
        shippingAddress: {
          ...shippingAddress,
          country: 'fr',
          line1: '  12 Rue A  ',
          line2: '  ',
        },
      } as any);

      expect(result.shippingAddress).toMatchObject({
        line1: '12 Rue A',
        country: 'FR',
      });
      expect(result.shippingAddress?.line2).toBeUndefined();
      expect(result.shippingAmount).toBe(0);
      expect(result.total).toBe(5000);
    });
  });

  describe('totals with coupons', () => {
    it('keeps the shipping amount when a coupon is applied or removed', async () => {
      storedSession = makeSession({
        shippingAmount: 500,
        shippingOptionId: 'standard',
      });

      const discounted = await service.applyCoupon('pub-1234567890', 'FIVEOFF');
      expect(discounted.discountAmount).toBe(500);
      expect(discounted.total).toBe(5000);

      const restored = await service.removeCoupon('pub-1234567890');
      expect(restored.discountAmount).toBe(0);
      expect(restored.total).toBe(5500);
    });
  });

  describe('completeSession', () => {
    it('copies the address to a new customer and exposes shipping in the webhook', async () => {
      storedSession = makeSession({
        shippingAddress,
        shippingOptionId: 'standard',
        shippingAmount: 500,
        total: 5500,
      });

      await service.completeSession('pub-1234567890', 'Buyer@Example.com');

      expect(customerRepo.findOne).toHaveBeenCalledWith({
        where: { merchantId, email: 'buyer@example.com' },
      });
      expect(customerRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          merchantId,
          email: 'buyer@example.com',
          name: 'Jane Doe',
          shippingAddress,
        }),
      );
      expect(webhooksService.dispatchEventToMerchant).toHaveBeenCalledWith(
        merchantId,
        'checkout.session.completed',
        expect.objectContaining({
          shippingAddress,
          shippingAmount: '500',
          shippingOptionId: 'standard',
        }),
      );
    });

    it('updates an existing customer instead of creating a duplicate', async () => {
      const existing = {
        id: 'customer-1',
        merchantId,
        email: 'buyer@example.com',
        name: null,
        shippingAddress: null,
      };
      customerRepo.findOne.mockResolvedValue(existing);
      storedSession = makeSession({ shippingAddress });

      await service.completeSession('pub-1234567890', 'buyer@example.com');

      expect(customerRepo.create).not.toHaveBeenCalled();
      expect(existing.shippingAddress).toEqual(shippingAddress);
      expect(existing.name).toBe('Jane Doe');
    });

    it('does not fail completion when the customer write fails', async () => {
      customerRepo.save.mockRejectedValue(new Error('db down'));
      storedSession = makeSession({ shippingAddress });

      await expect(
        service.completeSession('pub-1234567890', 'buyer@example.com'),
      ).resolves.toMatchObject({
        session: { status: CheckoutSessionStatus.COMPLETE },
      });
      expect(paymentsService.create).toHaveBeenCalled();
    });
  });
});
