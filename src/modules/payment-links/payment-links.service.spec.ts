import { ForbiddenException } from '@nestjs/common';
import { PaymentLinksService } from './payment-links.service';

describe('PaymentLinksService merchant suspension', () => {
  it('blocks redemption for a suspended link owner', async () => {
    const link = {
      id: 'link-id',
      token: 'token',
      merchantId: 'merchant-id',
      isActive: true,
      expiresAt: null,
      views: 0,
    };
    const repo = {
      findOneBy: jest.fn().mockResolvedValue(link),
      increment: jest.fn().mockResolvedValue(undefined),
    };
    const usersService = {
      assertMerchantActive: jest
        .fn()
        .mockRejectedValue(new ForbiddenException('Merchant is suspended')),
    };
    const service = new PaymentLinksService(
      repo as any,
      {} as any,
      {} as any,
      { child: () => ({}) } as any,
      usersService as any,
    );

    await expect(service.redeemLink('token', {} as any)).rejects.toThrow(
      ForbiddenException,
    );
    expect(usersService.assertMerchantActive).toHaveBeenCalledWith('merchant-id');
  });
});

describe('PaymentLinksService duplicate', () => {
  const source = {
    id: 'link-id',
    token: 'original-token',
    slug: 'original-slug',
    merchantId: 'merchant-id',
    amount: '25.00',
    flexibleAmount: false,
    minAmount: null,
    currency: 'USD',
    description: 'Original description',
    expiresAt: new Date('2027-01-01T00:00:00.000Z'),
    maxCompletions: 5,
    requiredFields: { name: true, email: false, phone: false },
    customFields: [],
    successUrl: null,
    cancelUrl: null,
    isActive: false,
    views: 42,
    completions: 3,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  };

  function createService() {
    const repo = {
      findOneBy: jest.fn().mockResolvedValue(source),
      create: jest.fn((value) => ({
        isActive: true,
        views: 0,
        completions: 0,
        ...value,
      })),
      save: jest.fn(async (value) => ({ id: 'new-id', ...value })),
    };
    const usersService = { assertMerchantActive: jest.fn() };
    const service = new PaymentLinksService(
      repo as any,
      {} as any,
      {} as any,
      { child: () => ({}) } as any,
      usersService as any,
    );
    return { repo, usersService, service };
  }

  it('copies configuration with a fresh token and reset identity and counters', async () => {
    const { repo, service } = createService();

    const result = await service.duplicate('link-id', 'merchant-id');
    const savedLink = repo.save.mock.calls[0][0];

    expect(result.id).toBe('new-id');
    expect(savedLink.token).toMatch(/^[a-f0-9]{32}$/);
    expect(savedLink.token).not.toBe(source.token);
    expect(savedLink.slug).toBeNull();
    expect(savedLink.views).toBe(0);
    expect(savedLink.completions).toBe(0);
    expect(savedLink.isActive).toBe(true);
    expect(savedLink.amount).toBe(25);
    expect(savedLink.maxCompletions).toBe(5);
    expect(savedLink.merchantId).toBe('merchant-id');
    expect(savedLink.id).toBeUndefined();
    expect(savedLink.createdAt).toBeUndefined();
    expect(savedLink.updatedAt).toBeUndefined();
  });

  it('applies overrides to copied configuration', async () => {
    const { repo, service } = createService();

    await service.duplicate('link-id', 'merchant-id', {
      amount: 40,
      description: 'Variant',
      slug: 'new-variant',
    });

    expect(repo.save.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        amount: 40,
        description: 'Variant',
        slug: 'new-variant',
      }),
    );
  });

  it('rejects duplicating another merchant payment link', async () => {
    const { service } = createService();

    await expect(
      service.duplicate('link-id', 'another-merchant'),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('PaymentLinksService bulkDeactivate', () => {
  const merchantId = 'merchant-id';

  function createService(owned: Array<{ id: string; isActive: boolean }>) {
    const repo = {
      find: jest.fn().mockResolvedValue(owned.map((l) => ({ ...l, merchantId }))),
      update: jest.fn().mockResolvedValue({ affected: owned.length }),
    };
    const service = new PaymentLinksService(
      repo as any,
      {} as any,
      {} as any,
      { child: () => ({}) } as any,
      {} as any,
    );
    return { service, repo };
  }

  it('deactivates owned active links and returns per-id results', async () => {
    const { service, repo } = createService([
      { id: 'a', isActive: true },
      { id: 'b', isActive: false },
    ]);

    const result = await service.bulkDeactivate(['a', 'b', 'c'], merchantId);

    expect(repo.find).toHaveBeenCalledWith({
      where: { id: expect.anything(), merchantId },
    });
    expect(repo.update).toHaveBeenCalledTimes(1);
    const [criteria, patch] = repo.update.mock.calls[0];
    expect(criteria.merchantId).toBe(merchantId);
    expect(criteria.id.value).toEqual(['a']);
    expect(patch).toEqual({ isActive: false });

    expect(result).toEqual({
      results: [
        { id: 'a', status: 'deactivated' },
        { id: 'b', status: 'already_inactive' },
        { id: 'c', status: 'skipped', reason: 'Payment link not found' },
      ],
      deactivated: 1,
      skipped: 1,
    });
  });

  it('skips ids belonging to other merchants without updating anything', async () => {
    const { service, repo } = createService([]);

    const result = await service.bulkDeactivate(['foreign-id'], merchantId);

    expect(repo.update).not.toHaveBeenCalled();
    expect(result.results).toEqual([
      { id: 'foreign-id', status: 'skipped', reason: 'Payment link not found' },
    ]);
    expect(result.deactivated).toBe(0);
  });

  it('de-duplicates repeated ids', async () => {
    const { service } = createService([{ id: 'a', isActive: true }]);

    const result = await service.bulkDeactivate(['a', 'a', 'a'], merchantId);

    expect(result.results).toHaveLength(1);
    expect(result.deactivated).toBe(1);
  });

  it('rejects more than 100 ids', async () => {
    const { service, repo } = createService([]);
    const ids = Array.from({ length: 101 }, (_, i) => `id-${i}`);

    await expect(service.bulkDeactivate(ids, merchantId)).rejects.toThrow(
      'A maximum of 100 ids can be deactivated at once',
    );
    expect(repo.find).not.toHaveBeenCalled();
  });
});

describe('PaymentLinksService Analytics', () => {
  const merchantId = 'merchant-123';
  const linkId = 'link-456';

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-15T00:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function createAnalyticsService(eventData: any[] = []) {
    const linkRepo = {
      findOneBy: jest.fn().mockResolvedValue({
        id: linkId,
        merchantId,
        amount: 1000,
        currency: 'USD',
      }),
    };

    const eventRepo = {
      find: jest.fn().mockResolvedValue(eventData),
    };

    const service = new PaymentLinksService(
      linkRepo as any,
      eventRepo as any,
      {} as any,
      { child: () => ({ info: jest.fn(), error: jest.fn() }) } as any,
      {} as any,
    );

    return { service, linkRepo, eventRepo };
  }

  describe('recordView', () => {
    it('records a view event with IP hash and user agent', async () => {
      const { service, eventRepo } = createAnalyticsService();
      const mockSave = jest.fn().mockResolvedValue({});
      eventRepo.save = mockSave;
      eventRepo.create = jest.fn((data) => data);

      await service.recordView(linkId, '192.168.1.1', 'Mozilla/5.0');

      expect(eventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          paymentLinkId: linkId,
          type: 'VIEW',
          ipHash: expect.any(String),
          userAgent: 'Mozilla/5.0',
        }),
      );
      expect(mockSave).toHaveBeenCalled();
    });

    it('handles missing IP gracefully', async () => {
      const { service, eventRepo } = createAnalyticsService();
      const mockSave = jest.fn().mockResolvedValue({});
      eventRepo.save = mockSave;
      eventRepo.create = jest.fn((data) => data);

      await service.recordView(linkId, undefined);

      expect(eventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'VIEW',
          paymentLinkId: linkId,
        }),
      );
    });
  });

  describe('recordRedeem', () => {
    it('records a redeem event', async () => {
      const { service, eventRepo } = createAnalyticsService();
      const mockSave = jest.fn().mockResolvedValue({});
      eventRepo.save = mockSave;
      eventRepo.create = jest.fn((data) => data);

      await service.recordRedeem(linkId, '203.0.113.42', 'Chrome/96.0');

      expect(eventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          paymentLinkId: linkId,
          type: 'REDEEM',
        }),
      );
    });
  });

  describe('recordComplete', () => {
    it('records a complete event with payment amount', async () => {
      const { service, eventRepo } = createAnalyticsService();
      const mockSave = jest.fn().mockResolvedValue({});
      eventRepo.save = mockSave;
      eventRepo.create = jest.fn((data) => data);

      await service.recordComplete(linkId, 5000);

      expect(eventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          paymentLinkId: linkId,
          type: 'COMPLETE',
          amount: 5000,
        }),
      );
    });
  });

  describe('getAnalytics', () => {
    it('returns aggregated analytics for a payment link', async () => {
      const events = [
        {
          type: 'VIEW',
          createdAt: new Date('2026-01-10T10:00:00.000Z'),
          amount: null,
        },
        {
          type: 'VIEW',
          createdAt: new Date('2026-01-11T10:00:00.000Z'),
          amount: null,
        },
        {
          type: 'VIEW',
          createdAt: new Date('2026-01-12T10:00:00.000Z'),
          amount: null,
        },
        {
          type: 'REDEEM',
          createdAt: new Date('2026-01-12T14:00:00.000Z'),
          amount: null,
        },
        {
          type: 'COMPLETE',
          createdAt: new Date('2026-01-12T15:00:00.000Z'),
          amount: 1000,
        },
        {
          type: 'COMPLETE',
          createdAt: new Date('2026-01-13T10:00:00.000Z'),
          amount: 1500,
        },
      ];

      const { service, linkRepo, eventRepo } = createAnalyticsService(events);
      eventRepo.find.mockResolvedValue(events);

      const analytics = await service.getAnalytics(linkId, merchantId, {
        from: new Date('2026-01-10T00:00:00.000Z'),
        to: new Date('2026-01-13T23:59:59.999Z'),
        interval: 'day',
      });

      expect(linkRepo.findOneBy).toHaveBeenCalledWith({ id: linkId, merchantId });
      expect(analytics.linkId).toBe(linkId);
      expect(analytics.total).toEqual(
        expect.objectContaining({
          views: 3,
          redemptions: 1,
          completions: 2,
          revenue: 2500,
        }),
      );
    });

    it('calculates conversion rate correctly', async () => {
      const events = [
        { type: 'VIEW', createdAt: new Date('2026-01-12T10:00:00.000Z'), amount: null },
        { type: 'VIEW', createdAt: new Date('2026-01-12T11:00:00.000Z'), amount: null },
        { type: 'VIEW', createdAt: new Date('2026-01-12T12:00:00.000Z'), amount: null },
        { type: 'VIEW', createdAt: new Date('2026-01-12T13:00:00.000Z'), amount: null },
        { type: 'COMPLETE', createdAt: new Date('2026-01-12T14:00:00.000Z'), amount: 1000 },
      ];

      const { service, eventRepo } = createAnalyticsService(events);
      eventRepo.find.mockResolvedValue(events);

      const analytics = await service.getAnalytics(linkId, merchantId, {
        from: new Date('2026-01-12T00:00:00.000Z'),
        to: new Date('2026-01-12T23:59:59.999Z'),
        interval: 'day',
      });

      expect(analytics.total.conversionRate).toBe(0.25); // 1 completion / 4 views
    });

    it('buckets analytics by day', async () => {
      const events = [
        { type: 'VIEW', createdAt: new Date('2026-01-10T10:00:00.000Z'), amount: null },
        { type: 'COMPLETE', createdAt: new Date('2026-01-10T12:00:00.000Z'), amount: 1000 },
        { type: 'VIEW', createdAt: new Date('2026-01-11T10:00:00.000Z'), amount: null },
        { type: 'VIEW', createdAt: new Date('2026-01-11T14:00:00.000Z'), amount: null },
        { type: 'COMPLETE', createdAt: new Date('2026-01-11T15:00:00.000Z'), amount: 2000 },
      ];

      const { service, eventRepo } = createAnalyticsService(events);
      eventRepo.find.mockResolvedValue(events);

      const analytics = await service.getAnalytics(linkId, merchantId, {
        from: new Date('2026-01-10T00:00:00.000Z'),
        to: new Date('2026-01-11T23:59:59.999Z'),
        interval: 'day',
      });

      expect(analytics.buckets).toHaveLength(2);
      expect(analytics.buckets[0]).toEqual(
        expect.objectContaining({
          date: '2026-01-10',
          views: 1,
          completions: 1,
          revenue: 1000,
        }),
      );
      expect(analytics.buckets[1]).toEqual(
        expect.objectContaining({
          date: '2026-01-11',
          views: 2,
          completions: 1,
          revenue: 2000,
        }),
      );
    });

    it('buckets analytics by week', async () => {
      const events = [
        // Week 1 (Jan 5-11)
        { type: 'VIEW', createdAt: new Date('2026-01-05T10:00:00.000Z'), amount: null },
        { type: 'COMPLETE', createdAt: new Date('2026-01-05T12:00:00.000Z'), amount: 500 },
        // Week 2 (Jan 12-18)
        { type: 'VIEW', createdAt: new Date('2026-01-15T10:00:00.000Z'), amount: null },
        { type: 'COMPLETE', createdAt: new Date('2026-01-15T12:00:00.000Z'), amount: 1000 },
      ];

      const { service, eventRepo } = createAnalyticsService(events);
      eventRepo.find.mockResolvedValue(events);

      const analytics = await service.getAnalytics(linkId, merchantId, {
        from: new Date('2026-01-05T00:00:00.000Z'),
        to: new Date('2026-01-18T23:59:59.999Z'),
        interval: 'week',
      });

      expect(analytics.buckets).toHaveLength(2);
      expect(analytics.buckets[0].revenue).toBe(500);
      expect(analytics.buckets[1].revenue).toBe(1000);
    });

    it('filters analytics by date range', async () => {
      const events = [
        { type: 'VIEW', createdAt: new Date('2026-01-08T10:00:00.000Z'), amount: null },
        { type: 'VIEW', createdAt: new Date('2026-01-12T10:00:00.000Z'), amount: null },
        { type: 'VIEW', createdAt: new Date('2026-01-16T10:00:00.000Z'), amount: null },
      ];

      const { service, eventRepo } = createAnalyticsService(events);
      eventRepo.find.mockResolvedValue(
        events.filter(
          (e) =>
            e.createdAt >= new Date('2026-01-10T00:00:00.000Z') &&
            e.createdAt <= new Date('2026-01-14T23:59:59.999Z'),
        ),
      );

      const analytics = await service.getAnalytics(linkId, merchantId, {
        from: new Date('2026-01-10T00:00:00.000Z'),
        to: new Date('2026-01-14T23:59:59.999Z'),
        interval: 'day',
      });

      expect(analytics.total.views).toBe(1);
    });

    it('returns zero analytics for link with no events', async () => {
      const { service, eventRepo } = createAnalyticsService([]);
      eventRepo.find.mockResolvedValue([]);

      const analytics = await service.getAnalytics(linkId, merchantId, {
        from: new Date('2026-01-10T00:00:00.000Z'),
        to: new Date('2026-01-15T00:00:00.000Z'),
        interval: 'day',
      });

      expect(analytics.total).toEqual({
        views: 0,
        redemptions: 0,
        completions: 0,
        conversionRate: 0,
        revenue: 0,
      });
    });

    it('prevents access to analytics for links owned by other merchants', async () => {
      const { service, linkRepo } = createAnalyticsService();
      linkRepo.findOneBy.mockResolvedValue(null);

      await expect(
        service.getAnalytics(linkId, 'different-merchant', {
          from: new Date('2026-01-10T00:00:00.000Z'),
          to: new Date('2026-01-15T00:00:00.000Z'),
          interval: 'day',
        }),
      ).rejects.toThrow();
    });

    it('uses default date range when not provided', async () => {
      const { service, eventRepo } = createAnalyticsService();
      eventRepo.find.mockResolvedValue([]);

      const analytics = await service.getAnalytics(linkId, merchantId);

      expect(eventRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            paymentLinkId: linkId,
            createdAt: expect.anything(),
          }),
        }),
      );
    });
  });
});
