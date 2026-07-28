import { ConflictException, NotFoundException } from '@nestjs/common';
import { RecurringPaymentsService } from './recurring-payments.service';
import {
  RecurringPaymentInterval,
  RecurringPaymentStatus,
} from './recurring-payment.entity';

describe('RecurringPaymentsService', () => {
  let service: RecurringPaymentsService;
  let mockRepository: any;
  let mockPaymentsService: any;
  let mockIdempotencyService: any;
  let mockAppLogger: any;

  beforeEach(() => {
    mockRepository = {
      create: jest.fn((data) => ({ ...data })),
      save: jest.fn((entity) => Promise.resolve(entity)),
      find: jest.fn(),
      findOneBy: jest.fn(),
    };

    mockPaymentsService = {
      create: jest.fn().mockResolvedValue({ id: 'payment-1' }),
    };

    mockIdempotencyService = {
      checkKey: jest.fn().mockResolvedValue(null),
      storeKey: jest.fn().mockResolvedValue(undefined),
    };

    mockAppLogger = {
      child: jest.fn().mockReturnValue({ info: jest.fn(), error: jest.fn() }),
    };

    service = new RecurringPaymentsService(
      mockRepository,
      mockPaymentsService,
      mockIdempotencyService,
      mockAppLogger,
    );
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
      );
      expect(mockIdempotencyService.storeKey).toHaveBeenCalledWith(
        `recurring-payment:plan-1:${dueAt.toISOString()}`,
        expect.anything(),
        { paymentId: 'payment-1' },
      );
      expect(plan.lastRunAt).toEqual(dueAt);
      expect(plan.nextRunAt.getTime()).toBe(dueAt.getTime() + 24 * 60 * 60 * 1000);
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

    it('logs and continues when a charge fails, leaving the plan due for retry', async () => {
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
      mockPaymentsService.create.mockRejectedValue(new Error('boom'));

      await service.processDuePlans();

      expect(plan.nextRunAt).toBe(dueAt);
      expect(mockRepository.save).not.toHaveBeenCalled();
    });
  });
});
