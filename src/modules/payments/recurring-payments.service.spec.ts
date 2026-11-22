import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { RecurringPaymentsService } from './recurring-payments.service';
import {
  RecurringPaymentInterval,
  RecurringPaymentStatus,
} from './recurring-payment.entity';
import {
  RecurringPaymentChargeStatus,
} from './recurring-payment-charge.entity';
import { createHash, createHmac } from 'crypto';

jest.mock('./payments.service', () => ({
  PaymentsService: class PaymentsService {},
}));
jest.mock('../logger/logger.service', () => ({
  AppLogger: class AppLogger {},
}));

describe('RecurringPaymentsService', () => {
  let service: RecurringPaymentsService;
  let mockRepository: any;
  let mockChargeRepository: any;
  let mockPaymentsService: any;
  let mockIdempotencyService: any;
  let mockWebhooksService: any;
  let mockEmailNotificationService: any;
  let mockAppLogger: any;

  beforeEach(() => {
    jest.useRealTimers();
    mockCustomerRepository = {
      findOneBy: jest.fn(),
    };
    mockRepository = {
      create: jest.fn((data) => ({ ...data })),
      save: jest.fn((entity) => Promise.resolve(entity)),
      find: jest.fn(),
      findOneBy: jest.fn(),
      createQueryBuilder: jest.fn(),
      manager: {
        getRepository: jest.fn(() => mockCustomerRepository),
      },
    };

    mockChargeRepository = {
      create: jest.fn((data) => ({ ...data })),
      save: jest.fn((entity) => Promise.resolve(entity)),
      createQueryBuilder: jest.fn(),
    };

    mockPaymentsService = {
      create: jest.fn().mockResolvedValue({ id: 'payment-1' }),
    };

    mockIdempotencyService = {
      checkKey: jest.fn().mockResolvedValue(null),
      storeKey: jest.fn().mockResolvedValue(undefined),
    };

    mockWebhooksService = {
      dispatchEventToMerchant: jest.fn().mockResolvedValue(undefined),
    };

    mockEmailNotificationService = {
      sendPayerRecurringPaymentReminder: jest.fn().mockResolvedValue(undefined),
    };

    mockAppLogger = {
      child: jest.fn().mockReturnValue({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }),
    };

    service = new RecurringPaymentsService(
      mockRepository,
      mockChargeRepository,
      mockPaymentsService,
      mockIdempotencyService,
      mockWebhooksService,
      mockEmailNotificationService,
      { get: jest.fn((_key, defaultValue) => defaultValue) } as any,
      mockAppLogger,
    );
  });

  describe('payer cancellation links', () => {
    it('validates and consumes a signed cancellation link once', async () => {
      const plan: any = {
        id: 'plan-1',
        amount: 25,
        currency: 'USD',
        description: 'Monthly plan',
        nextRunAt: new Date(Date.now() + 86400000),
        payerEmail: 'payer@example.com',
        merchantEmail: 'merchant@example.com',
        merchantId: 'merchant-1',
        payerCancellationEnabled: true,
        status: RecurringPaymentStatus.ACTIVE,
        cancelTokenHash: null,
        cancelTokenExpiresAt: null,
        cancelTokenUsedAt: null,
      };
      mockRepository.save.mockImplementation(async (entity) => entity);
      await (service as any).notifyPayer(plan);

      const cancelUrl = mockEmailNotificationService
        .sendPayerRecurringPaymentReminder.mock.calls[0][8];
      const token = new URL(cancelUrl).searchParams.get('token');
      expect(token).toBeTruthy();
      expect(plan.cancelTokenHash).toBe(
        createHash('sha256').update(token).digest('hex'),
      );

      mockRepository.findOneBy.mockResolvedValue(plan);
      await expect(service.getPayerCancellation(token)).resolves.toMatchObject({
        planId: 'plan-1',
        amount: 25,
        currency: 'USD',
      });

      const query: any = {};
      for (const method of ['update', 'set', 'where', 'andWhere']) {
        query[method] = jest.fn().mockImplementation((value) => {
          if (method === 'set') Object.assign(plan, value);
          return query;
        });
      }
      query.execute = jest.fn().mockResolvedValue({ affected: 1 });
      mockRepository.createQueryBuilder.mockReturnValue(query);

      await service.cancelWithToken(token);
      expect(plan.status).toBe(RecurringPaymentStatus.CANCELLED);
      expect(plan.cancelTokenUsedAt).toBeInstanceOf(Date);
      expect(mockWebhooksService.dispatchEventToMerchant).toHaveBeenCalledWith(
        'merchant-1',
        'recurring.cancelled',
        { planId: 'plan-1' },
      );
      await expect(service.getPayerCancellation(token)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('does not include a cancellation link when the merchant opted out', async () => {
      const plan = {
        id: 'plan-1',
        payerEmail: 'payer@example.com',
        merchantEmail: 'merchant@example.com',
        payerCancellationEnabled: false,
      } as any;

      await (service as any).notifyPayer(plan);

      expect(
        mockEmailNotificationService.sendPayerRecurringPaymentReminder.mock
          .calls[0][8],
      ).toBe('');
      expect(mockRepository.save).not.toHaveBeenCalled();
    });

    it('invalidates an existing token when the merchant opts out', async () => {
      const plan = {
        id: 'plan-1',
        createdBy: 'merchant-1',
        payerCancellationEnabled: true,
        cancelTokenHash: 'a'.repeat(64),
        cancelTokenExpiresAt: new Date(Date.now() + 86400000),
        cancelTokenUsedAt: null,
      } as any;
      mockRepository.findOneBy.mockResolvedValue(plan);

      await service.update('plan-1', 'merchant-1', {
        payerCancellationEnabled: false,
      });

      expect(plan.payerCancellationEnabled).toBe(false);
      expect(plan.cancelTokenHash).toBeNull();
      expect(plan.cancelTokenExpiresAt).toBeNull();
      expect(mockRepository.save).toHaveBeenCalledWith(plan);
    });

    it('rejects a validly signed but expired cancellation token', async () => {
      const encodedPayload = Buffer.from(
        JSON.stringify({
          planId: 'plan-1',
          expiresAt: Date.now() - 1000,
          nonce: 'nonce',
        }),
      ).toString('base64url');
      const signature = createHmac('sha256', 'your-secret-key')
        .update(encodedPayload)
        .digest('hex');

      await expect(
        service.getPayerCancellation(`${encodedPayload}.${signature}`),
      ).rejects.toThrow(BadRequestException);
      expect(mockRepository.findOneBy).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('creates an active plan owned by the requesting user', async () => {
      const plan = await service.create(
        {
          amount: 29.99,
          currency: 'USD',
          interval: RecurringPaymentInterval.MONTHLY,
        },
        'user-1',
      );

      expect(plan.createdBy).toBe('user-1');
      expect(plan.status).toBe(RecurringPaymentStatus.ACTIVE);
      expect(plan.nextRunAt).toBeInstanceOf(Date);
    });

    it('persists a customer association owned by the requesting merchant', async () => {
      mockCustomerRepository.findOneBy.mockResolvedValueOnce({
        id: 'customer-1',
        merchantId: 'user-1',
      });

      const plan = await service.create(
        {
          amount: 10,
          currency: 'USD',
          interval: RecurringPaymentInterval.MONTHLY,
          customerId: 'customer-1',
        },
        'user-1',
      );

      expect(plan.customerId).toBe('customer-1');
      expect(plan.merchantId).toBe('user-1');
    });

    it('rejects a customer owned by another merchant', async () => {
      mockCustomerRepository.findOneBy.mockResolvedValueOnce({
        id: 'customer-1',
        merchantId: 'user-2',
      });

      await expect(
        service.create(
          {
            amount: 10,
            currency: 'USD',
            interval: RecurringPaymentInterval.MONTHLY,
            customerId: 'customer-1',
          },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('schedules the first run at startAt when provided', async () => {
      const startAt = '2026-08-01T00:00:00.000Z';
      const plan = await service.create(
        {
          amount: 10,
          currency: 'USD',
          interval: RecurringPaymentInterval.WEEKLY,
          startAt,
        },
        'user-1',
      );

      expect(plan.nextRunAt.toISOString()).toBe(startAt);
    });

    it('starts a trialing plan and schedules its first charge at trialEndsAt', async () => {
      const startAt = new Date(Date.now() + 1000);
      const plan = await service.create(
        {
          amount: 10,
          currency: 'USD',
          interval: RecurringPaymentInterval.MONTHLY,
          startAt: startAt.toISOString(),
          trialDays: 14,
        },
        'user-1',
      );

      expect(plan.status).toBe(RecurringPaymentStatus.TRIALING);
      expect(plan.trialDays).toBe(14);
      expect(plan.trialEndsAt).toEqual(
        new Date(startAt.getTime() + 14 * 24 * 60 * 60 * 1000),
      );
      expect(plan.nextRunAt).toEqual(plan.trialEndsAt);
    });
  });

  describe('pause / resume / cancel', () => {
    it('pauses an active plan', async () => {
      mockRepository.findOneBy.mockResolvedValue({
        id: 'plan-1',
        createdBy: 'user-1',
        status: RecurringPaymentStatus.ACTIVE,
        nextRunAt: new Date(Date.now() + 10000),
      });

      const result = await service.pause('plan-1', 'user-1');
      expect(result.status).toBe(RecurringPaymentStatus.PAUSED);
    });

    it('throws when pausing a non-active plan', async () => {
      mockRepository.findOneBy.mockResolvedValue({
        id: 'plan-1',
        createdBy: 'user-1',
        status: RecurringPaymentStatus.CANCELLED,
      });

      await expect(service.pause('plan-1', 'user-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('resumes a paused plan', async () => {
      mockRepository.findOneBy.mockResolvedValue({
        id: 'plan-1',
        createdBy: 'user-1',
        status: RecurringPaymentStatus.PAUSED,
        nextRunAt: new Date(Date.now() - 10000),
      });

      const result = await service.resume('plan-1', 'user-1');
      expect(result.status).toBe(RecurringPaymentStatus.ACTIVE);
    });

    it('throws when resuming a non-paused plan', async () => {
      mockRepository.findOneBy.mockResolvedValue({
        id: 'plan-1',
        createdBy: 'user-1',
        status: RecurringPaymentStatus.ACTIVE,
      });

      await expect(service.resume('plan-1', 'user-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('cancels an active plan', async () => {
      mockRepository.findOneBy.mockResolvedValue({
        id: 'plan-1',
        createdBy: 'user-1',
        status: RecurringPaymentStatus.ACTIVE,
      });

      const result = await service.cancel('plan-1', 'user-1');
      expect(result.status).toBe(RecurringPaymentStatus.CANCELLED);
      expect(result.cancelledAt).toBeInstanceOf(Date);
    });

    it('cancels a trialing plan without allowing a charge in the due sweep', async () => {
      const plan = {
        id: 'trial-plan',
        createdBy: 'user-1',
        status: RecurringPaymentStatus.TRIALING,
        trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      };
      mockRepository.findOneBy.mockResolvedValue(plan);

      const cancelled = await service.cancel('trial-plan', 'user-1');
      mockRepository.find.mockResolvedValue([]);
      await service.processDuePlans();

      expect(cancelled.status).toBe(RecurringPaymentStatus.CANCELLED);
      expect(cancelled.cancelledAt).toBeInstanceOf(Date);
      expect(mockPaymentsService.create).not.toHaveBeenCalled();
      expect(mockRepository.find).toHaveBeenCalledWith({
        where: [
          expect.objectContaining({ status: RecurringPaymentStatus.ACTIVE }),
          expect.objectContaining({ status: RecurringPaymentStatus.TRIALING }),
        ],
      });
    });

    it('throws when cancelling an already-cancelled plan', async () => {
      mockRepository.findOneBy.mockResolvedValue({
        id: 'plan-1',
        createdBy: 'user-1',
        status: RecurringPaymentStatus.CANCELLED,
      });

      await expect(service.cancel('plan-1', 'user-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws NotFoundException for a plan the user does not own', async () => {
      mockRepository.findOneBy.mockResolvedValue(null);

      await expect(service.pause('missing', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('rejects endAt values in the past', async () => {
      await expect(
        service.create(
          {
            amount: 29.99,
            currency: 'USD',
            interval: RecurringPaymentInterval.MONTHLY,
            endAt: new Date(Date.now() - 1000).toISOString(),
          },
          'user-1',
        ),
      ).rejects.toThrow('endAt must be in the future');
    });
  });

  describe('processDuePlans', () => {
    it('creates a payment for each due plan and advances nextRunAt', async () => {
      const dueAt = new Date('2026-07-01T00:00:00.000Z');
      const plan = {
        id: 'plan-1',
        amount: 20,
        currency: 'USD',
        interval: RecurringPaymentInterval.DAILY,
        status: RecurringPaymentStatus.ACTIVE,
        nextRunAt: dueAt,
        description: null,
        merchantId: null,
        merchantEmail: null,
        payerEmail: null,
        callbackUrl: null,
        metadata: null,
      };
      mockRepository.find.mockResolvedValue([plan]);

      await service.processDuePlans();

      expect(mockPaymentsService.create).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 20, currency: 'USD' }),
        'plan-1',
      );
      expect(mockIdempotencyService.storeKey).toHaveBeenCalledWith(
        `recurring-payment:plan-1:${dueAt.toISOString()}`,
        expect.anything(),
        { paymentId: 'payment-1' },
      );
      expect(plan.lastRunAt).toEqual(dueAt);
      expect(plan.nextRunAt.getTime()).toBe(dueAt.getTime() + 24 * 60 * 60 * 1000);
      expect(mockChargeRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          recurringPaymentId: 'plan-1',
          cycleNumber: 1,
          paymentId: 'payment-1',
          status: RecurringPaymentChargeStatus.SUCCEEDED,
        }),
      );
    });

    it('adds a pending proration adjustment to the next charge and consumes it on success', async () => {
      const dueAt = new Date('2026-07-11T00:00:00.000Z');
      const plan = {
        id: 'plan-1',
        amount: 30,
        pendingProrationAmount: 7,
        prorationBaseAmount: 20,
        currency: 'USD',
        interval: RecurringPaymentInterval.DAILY,
        status: RecurringPaymentStatus.ACTIVE,
        nextRunAt: dueAt,
        description: null,
        merchantId: null,
        merchantEmail: null,
        payerEmail: null,
        callbackUrl: null,
        metadata: null,
      };
      mockRepository.find.mockResolvedValue([plan]);

      await service.processDuePlans();

      expect(mockPaymentsService.create).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 37, currency: 'USD' }),
        'plan-1',
      );
      expect(mockChargeRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 37, prorationAmount: 7 }),
      );
      expect(plan.pendingProrationAmount).toBeNull();
      expect(plan.prorationBaseAmount).toBeNull();
    });

    it('records a failed charge attempt and its failure reason', async () => {
      const dueAt = new Date('2026-07-01T00:00:00.000Z');
      const plan = {
        id: 'plan-1',
        amount: 20,
        currency: 'USD',
        interval: RecurringPaymentInterval.DAILY,
        status: RecurringPaymentStatus.ACTIVE,
        nextRunAt: dueAt,
        occurrences: 2,
        consecutiveFailures: 0,
      };
      mockRepository.find.mockResolvedValue([plan]);
      mockPaymentsService.create.mockRejectedValueOnce(
        new Error('payment gateway declined'),
      );

      await service.processDuePlans();

      expect(mockChargeRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          recurringPaymentId: 'plan-1',
          cycleNumber: 3,
          amount: 20,
          status: RecurringPaymentChargeStatus.PENDING,
        }),
      );
      expect(mockChargeRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          cycleNumber: 3,
          paymentId: null,
          status: RecurringPaymentChargeStatus.FAILED,
          failureReason: 'payment gateway declined',
        }),
      );
    });

    it('transitions a due trial to active before creating the first charge', async () => {
      const trialEndsAt = new Date(Date.now() - 1000);
      const plan = {
        id: 'trial-plan',
        amount: 20,
        currency: 'USD',
        interval: RecurringPaymentInterval.DAILY,
        status: RecurringPaymentStatus.TRIALING,
        nextRunAt: trialEndsAt,
        trialEndsAt,
        occurrences: 0,
        maxOccurrences: null,
        endAt: null,
        consecutiveFailures: 0,
      };
      mockRepository.find.mockResolvedValue([plan]);

      await service.processDuePlans();

      expect(mockPaymentsService.create).toHaveBeenCalledTimes(1);
      expect(plan.status).toBe(RecurringPaymentStatus.ACTIVE);
      expect(plan.lastRunAt).toEqual(trialEndsAt);
    });

    it('copies the customer association to the generated payment', async () => {
      const dueAt = new Date('2026-07-01T00:00:00.000Z');
      const plan = {
        id: 'plan-1',
        amount: 20,
        currency: 'USD',
        interval: RecurringPaymentInterval.DAILY,
        status: RecurringPaymentStatus.ACTIVE,
        nextRunAt: dueAt,
        merchantId: 'merchant-1',
        customerId: 'customer-1',
      };
      mockRepository.find.mockResolvedValue([plan]);

      await service.processDuePlans();

      expect(mockPaymentsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId: 'customer-1',
          merchantId: 'merchant-1',
        }),
        'plan-1',
      );
    });

    it('skips creating a duplicate payment when the run was already processed', async () => {
      const dueAt = new Date('2026-07-01T00:00:00.000Z');
      const plan = {
        id: 'plan-1',
        amount: 20,
        currency: 'USD',
        interval: RecurringPaymentInterval.DAILY,
        status: RecurringPaymentStatus.ACTIVE,
        nextRunAt: dueAt,
      };
      mockRepository.find.mockResolvedValue([plan]);
      mockIdempotencyService.checkKey.mockResolvedValue({ paymentId: 'existing-payment' });

      await service.processDuePlans();

      expect(mockPaymentsService.create).not.toHaveBeenCalled();
      expect(plan.lastRunAt).toEqual(dueAt);
    });

    it('auto-pauses the plan after the configured number of consecutive failures', async () => {
      const dueAt = new Date('2026-07-01T00:00:00.000Z');
      const plan = {
        id: 'plan-1',
        amount: 20,
        currency: 'USD',
        interval: RecurringPaymentInterval.DAILY,
        status: RecurringPaymentStatus.ACTIVE,
        nextRunAt: dueAt,
        consecutiveFailures: 2,
      };
      mockRepository.find.mockResolvedValue([plan]);
      mockPaymentsService.create.mockRejectedValue(new Error('boom'));

      await service.processDuePlans();

      expect(plan.consecutiveFailures).toBe(3);
      expect(plan.status).toBe(RecurringPaymentStatus.PAUSED);
      expect(mockPaymentsService.create).toHaveBeenCalledTimes(1);
      expect(mockRepository.save).toHaveBeenCalledWith(plan);
    });

    it('auto-cancels a plan when maxOccurrences is reached and does not process a 13th charge', async () => {
      const dueAt = new Date('2026-07-01T00:00:00.000Z');
      const plan = {
        id: 'plan-1',
        amount: 20,
        currency: 'USD',
        interval: RecurringPaymentInterval.DAILY,
        status: RecurringPaymentStatus.ACTIVE,
        nextRunAt: dueAt,
        occurrences: 12,
        maxOccurrences: 12,
      };
      mockRepository.find.mockResolvedValue([plan]);

      await service.processDuePlans();

      expect(plan.occurrences).toBe(13);
      expect(plan.status).toBe(RecurringPaymentStatus.CANCELLED);
      expect(mockPaymentsService.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('notifyTrialEnding', () => {
    it('dispatches the trial-ending event once within three days of trial end', async () => {
      const plan = {
        id: 'trial-plan',
        merchantId: 'merchant-1',
        status: RecurringPaymentStatus.TRIALING,
        trialEndsAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
        trialEndingNotifiedAt: null,
      };
      mockRepository.find.mockResolvedValue([plan]);

      await service.notifyTrialEnding();

      expect(mockWebhooksService.dispatchEventToMerchant).toHaveBeenCalledWith(
        'merchant-1',
        'recurring.trial_ending',
        { planId: 'trial-plan', trialEndsAt: plan.trialEndsAt },
      );
      expect(plan.trialEndingNotifiedAt).toBeInstanceOf(Date);
      expect(mockRepository.save).toHaveBeenCalledWith(plan);
    });
  });

  describe('findCharges', () => {
    it('returns charge history in chronological order with pagination', async () => {
      const charges = [{ id: 'charge-1', cycleNumber: 1 }];
      const query: any = {};
      query.where = jest.fn().mockReturnValue(query);
      query.orderBy = jest.fn().mockReturnValue(query);
      query.addOrderBy = jest.fn().mockReturnValue(query);
      query.skip = jest.fn().mockReturnValue(query);
      query.take = jest.fn().mockReturnValue(query);
      query.getManyAndCount = jest.fn().mockResolvedValue([charges, 3]);
      mockChargeRepository.createQueryBuilder.mockReturnValue(query);
      mockRepository.findOneBy.mockResolvedValue({
        id: 'plan-1',
        createdBy: 'user-1',
      });

      const result = await service.findCharges('plan-1', 'user-1', {
        page: 2,
        limit: 1,
      });

      expect(result).toEqual({ data: charges, total: 3, page: 2, limit: 1 });
      expect(query.where).toHaveBeenCalledWith(
        'charge.recurringPaymentId = :recurringPaymentId',
        { recurringPaymentId: 'plan-1' },
      );
      expect(query.orderBy).toHaveBeenCalledWith('charge.attemptedAt', 'ASC');
      expect(query.skip).toHaveBeenCalledWith(1);
      expect(query.take).toHaveBeenCalledWith(1);
    });

    it('does not query charge history for a plan the caller does not own', async () => {
      mockRepository.findOneBy.mockResolvedValue(null);

      await expect(
        service.findCharges('plan-1', 'other-user', {}),
      ).rejects.toThrow(NotFoundException);
      expect(mockChargeRepository.createQueryBuilder).not.toHaveBeenCalled();
    });
  });
});
