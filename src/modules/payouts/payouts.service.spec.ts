jest.mock('../../tracing', () => ({
  getTraceId: jest.fn(),
  initializeTracing: jest.fn(),
  runWithTrace: (_name: string, fn: () => unknown) => fn(),
}));

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PayoutsService } from './payouts.service';
import { Payout, PayoutStatus, ACTIVE_PAYOUT_STATUSES } from './entities/payout.entity';
import { MerchantPayoutLimit } from './entities/merchant-payout-limit.entity';

describe('PayoutsService', () => {
  const destination = `G${'A'.repeat(55)}`;
  const header = 'destination,amount,currency,reference\n';

  function setup(status = PayoutStatus.PENDING) {
    const payout = {
      id: 'p1',
      merchantId: 'm1',
      destination,
      amount: '10.0000000',
      currency: 'USDC',
      memo: 'invoice-1',
      reference: 'ref-1',
      status,
    } as Payout;
    const manager = {
      query: jest.fn(),
      findOne: jest.fn().mockResolvedValue(payout),
      create: jest.fn((_entity, row) => ({ id: 'p-new', ...row })),
      save: jest.fn(async (row) => row),
    };
    const payoutRepo = {
      findAndCount: jest.fn().mockResolvedValue([[payout], 1]),
      findOne: jest.fn().mockResolvedValue(payout),
      findOneByOrFail: jest.fn().mockResolvedValue({ ...payout }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      save: jest.fn(async (row) => row),
    };
    const limitRepo = {
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      upsert: jest.fn().mockResolvedValue(undefined),
    };
    const queue = {
      add: jest.fn().mockResolvedValue({ id: 'p-new' }),
      getJob: jest.fn().mockResolvedValue({ remove: jest.fn() }),
      addBulk: jest.fn(),
    };
    const source = {
      manager,
      transaction: jest.fn(async (callback) => callback(manager)),
    };
    const authService = { validateStepUpToken: jest.fn() };
    const usersService = { assertMerchantActive: jest.fn().mockResolvedValue(undefined) };
    const stellarService = {
      validatePayoutRecipient: jest.fn().mockResolvedValue(undefined),
      sendPayout: jest.fn().mockResolvedValue({ hash: 'tx-hash-123' }),
    };
    const webhooksService = {
      dispatchEventToMerchant: jest.fn().mockResolvedValue(undefined),
    };
    const eventsService = { emit: jest.fn() };
    const auditLogsService = { record: jest.fn().mockResolvedValue(undefined) };

    const service = Object.assign(Object.create(PayoutsService.prototype), {
      defaultDailyLimit: '10000',
      payoutRepo,
      limitRepo,
      dataSource: source,
      payoutsQueue: queue,
      authService,
      usersService,
      stellarService,
      webhooksService,
      eventsService,
      auditLogsService,
      logger: { warn: jest.fn(), error: jest.fn(), log: jest.fn() },
    }) as PayoutsService;

    return {
      service,
      payout,
      manager,
      payoutRepo,
      limitRepo,
      queue,
      source,
      authService,
      usersService,
      stellarService,
      webhooksService,
      eventsService,
      auditLogsService,
    };
  }

  describe('create (limit enforcement, balance checks, and queueing)', () => {
    it('validates step-up token, recipient, balance, and daily limit before saving and queueing', async () => {
      const {
        service,
        manager,
        queue,
        authService,
        usersService,
        stellarService,
        auditLogsService,
        eventsService,
      } = setup();
      manager.findOne
        .mockResolvedValueOnce(null) // no duplicate reference
        .mockResolvedValueOnce(null); // no custom MerchantPayoutLimit override
      manager.query
        .mockResolvedValueOnce([]) // pg_advisory_xact_lock
        .mockResolvedValueOnce([{ total: '500.0000000' }]) // credited payments
        .mockResolvedValueOnce([{ total: '100.0000000' }]) // settled
        .mockResolvedValueOnce([{ total: '50.0000000' }]) // active paidOut total
        .mockResolvedValueOnce([{ total: '20.0000000' }]); // usedToday

      const created = await service.create(
        'm1',
        {
          destination,
          amount: '100.5',
          currency: 'usdc',
          memo: '  payout-memo  ',
          reference: 'ref-unique',
        },
        'step-up-jwt',
        '127.0.0.1',
        'jest-agent',
      );

      expect(authService.validateStepUpToken).toHaveBeenCalledWith('step-up-jwt', 'm1');
      expect(usersService.assertMerchantActive).toHaveBeenCalledWith('m1');
      expect(stellarService.validatePayoutRecipient).toHaveBeenCalledWith(
        destination,
        'USDC',
        'payout-memo',
      );
      expect(created.amount).toBe('100.5000000');
      expect(created.currency).toBe('USDC');
      expect(created.status).toBe(PayoutStatus.PENDING);
      expect(queue.add).toHaveBeenCalledWith(
        'process',
        { payoutId: created.id },
        expect.objectContaining({
          jobId: created.id,
          attempts: 1,
          removeOnComplete: true,
          removeOnFail: false,
        }),
      );
      expect(auditLogsService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: 'm1',
          action: 'payout.created',
          resourceId: created.id,
        }),
      );
      expect(eventsService.emit).toHaveBeenCalledWith(
        'm1',
        'payout.created',
        expect.objectContaining({ payoutId: created.id, status: PayoutStatus.PENDING }),
      );
    });

    it('rejects memos longer than 28 UTF-8 bytes with BadRequestException', async () => {
      const { service, source } = setup();
      await expect(
        service.create(
          'm1',
          {
            destination,
            amount: '10',
            currency: 'USDC',
            memo: 'x'.repeat(29),
            reference: 'ref-long-memo',
          },
          'step-up-jwt',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(source.transaction).not.toHaveBeenCalled();
    });

    it('rejects duplicate payout reference for the same merchant with ConflictException', async () => {
      const { service, manager, queue } = setup();
      manager.findOne.mockResolvedValueOnce({ id: 'existing-payout' });

      await expect(
        service.create(
          'm1',
          { destination, amount: '10', currency: 'USDC', reference: 'dup-ref' },
          'step-up-jwt',
        ),
      ).rejects.toThrow(ConflictException);
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('rejects payout when amount exceeds available balance', async () => {
      const { service, manager, queue } = setup();
      manager.findOne.mockResolvedValueOnce(null); // no existing reference
      manager.query
        .mockResolvedValueOnce([]) // lock
        .mockResolvedValueOnce([{ total: '100.0000000' }]) // credited
        .mockResolvedValueOnce([{ total: '60.0000000' }]) // settled
        .mockResolvedValueOnce([{ total: '20.0000000' }]); // paidOut => available = 20

      await expect(
        service.create(
          'm1',
          { destination, amount: '25', currency: 'USDC', reference: 'ref-over-bal' },
          'step-up-jwt',
        ),
      ).rejects.toThrow('Insufficient available balance: 20.0000000 USDC available');
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('rejects payout when amount exceeds merchant daily limit', async () => {
      const { service, manager, queue } = setup();
      manager.findOne
        .mockResolvedValueOnce(null) // no existing reference
        .mockResolvedValueOnce({
          merchantId: 'm1',
          currency: 'USDC',
          dailyLimit: '50.0000000',
        } as MerchantPayoutLimit);
      manager.query
        .mockResolvedValueOnce([]) // lock
        .mockResolvedValueOnce([{ total: '500.0000000' }]) // credited
        .mockResolvedValueOnce([{ total: '0' }]) // settled
        .mockResolvedValueOnce([{ total: '30.0000000' }]) // all-time paidOut
        .mockResolvedValueOnce([{ total: '30.0000000' }]); // usedToday => remaining = 20

      await expect(
        service.create(
          'm1',
          { destination, amount: '25', currency: 'USDC', reference: 'ref-over-limit' },
          'step-up-jwt',
        ),
      ).rejects.toThrow('Daily payout limit of 50.0000000 USDC would be exceeded');
      expect(queue.add).not.toHaveBeenCalled();
    });
  });

  describe('process (Stellar submission, success, multi-sig, and failure ledger effects)', () => {
    it('transitions PENDING -> SUBMITTED -> COMPLETED and stores transactionHash on Stellar success', async () => {
      const { service, payoutRepo, stellarService, eventsService, webhooksService } = setup();
      stellarService.sendPayout.mockResolvedValue({ hash: 'stellar-tx-abc' });

      const result = await service.process('p1');

      expect(payoutRepo.update).toHaveBeenCalledWith(
        { id: 'p1', status: PayoutStatus.PENDING },
        expect.objectContaining({ status: PayoutStatus.SUBMITTED }),
      );
      expect(stellarService.sendPayout).toHaveBeenCalledWith({
        destination,
        amount: '10.0000000',
        assetCode: 'USDC',
        memo: 'invoice-1',
        merchantId: 'm1',
      });
      expect(result?.status).toBe(PayoutStatus.COMPLETED);
      expect(result?.transactionHash).toBe('stellar-tx-abc');
      expect(result?.completedAt).toBeInstanceOf(Date);
      expect(eventsService.emit).toHaveBeenCalledWith(
        'm1',
        'payout.submitted',
        expect.objectContaining({ payoutId: 'p1' }),
      );
      expect(eventsService.emit).toHaveBeenCalledWith(
        'm1',
        'payout.completed',
        expect.objectContaining({
          payoutId: 'p1',
          status: PayoutStatus.COMPLETED,
          transactionHash: 'stellar-tx-abc',
        }),
      );
      expect(webhooksService.dispatchEventToMerchant).toHaveBeenCalledWith(
        'm1',
        'payout.completed',
        expect.objectContaining({ transactionHash: 'stellar-tx-abc' }),
      );
    });

    it('keeps payout in SUBMITTED status when Stellar returns pending_signatures', async () => {
      const { service, payoutRepo, stellarService } = setup();
      payoutRepo.findOneByOrFail.mockResolvedValue({
        id: 'p1',
        merchantId: 'm1',
        destination,
        amount: '10.0000000',
        currency: 'USDC',
        memo: null,
        reference: 'ref-1',
        status: PayoutStatus.SUBMITTED,
      } as Payout);
      stellarService.sendPayout.mockResolvedValue({
        status: 'pending_signatures',
        multiSigTransactionId: 'msig-1',
      });

      const result = await service.process('p1');

      expect(result?.status).toBe(PayoutStatus.SUBMITTED);
      expect(payoutRepo.save).not.toHaveBeenCalled();
    });

    it('marks payout FAILED with failureReason and releases reserved balance when Stellar submission throws', async () => {
      const { service, payoutRepo, stellarService, eventsService } = setup();
      stellarService.sendPayout.mockRejectedValue(new Error('tx_failed: op_no_destination'));

      const result = await service.process('p1');

      expect(result?.status).toBe(PayoutStatus.FAILED);
      expect(result?.failureReason).toBe('tx_failed: op_no_destination');
      expect(result?.failedAt).toBeInstanceOf(Date);
      expect(ACTIVE_PAYOUT_STATUSES).not.toContain(PayoutStatus.FAILED);
      expect(payoutRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: PayoutStatus.FAILED,
          failureReason: 'tx_failed: op_no_destination',
        }),
      );
      expect(eventsService.emit).toHaveBeenCalledWith(
        'm1',
        'payout.failed',
        expect.objectContaining({
          payoutId: 'p1',
          status: PayoutStatus.FAILED,
          failureReason: 'tx_failed: op_no_destination',
        }),
      );
    });

    it('marks payout FAILED when Stellar submission returns no transaction hash', async () => {
      const { service, stellarService } = setup();
      stellarService.sendPayout.mockResolvedValue({});

      const result = await service.process('p1');

      expect(result?.status).toBe(PayoutStatus.FAILED);
      expect(result?.failureReason).toBe(
        'Stellar submission returned no transaction hash',
      );
    });
  });

  describe('getBalance, setDailyLimit, findAll, and findOne', () => {
    it('computes available balance as credited - settled - paidOut (clamped at 0)', async () => {
      const { service, manager } = setup();
      manager.query
        .mockResolvedValueOnce([{ total: '250.5000000' }]) // credited
        .mockResolvedValueOnce([{ total: '100.2500000' }]) // settled
        .mockResolvedValueOnce([{ total: '50.0000000' }]); // paidOut

      const balance = await service.getBalance('m1', 'usdc');
      expect(balance).toEqual({
        currency: 'USDC',
        available: '100.2500000',
        credited: '250.5000000',
        settled: '100.2500000',
        paidOut: '50.0000000',
      });
    });

    it('upserts normalized daily limit and deletes override when dailyLimit is null', async () => {
      const { service, limitRepo } = setup();

      const updated = await service.setDailyLimit('m1', 'usdc', '2500.5');
      expect(limitRepo.upsert).toHaveBeenCalledWith(
        { merchantId: 'm1', currency: 'USDC', dailyLimit: '2500.5000000' },
        ['merchantId', 'currency'],
      );
      expect(updated).toEqual({
        merchantId: 'm1',
        currency: 'USDC',
        dailyLimit: '2500.5000000',
      });

      const reset = await service.setDailyLimit('m1', 'usdc', null);
      expect(limitRepo.delete).toHaveBeenCalledWith({
        merchantId: 'm1',
        currency: 'USDC',
      });
      expect(reset.dailyLimit).toBe('10000');
    });

    it('paginates payouts in findAll and throws NotFoundException in findOne when missing', async () => {
      const { service, payoutRepo } = setup();
      const page = await service.findAll('m1', {
        page: 2,
        limit: 10,
        status: PayoutStatus.PENDING,
        currency: 'USDC',
      });
      expect(page.page).toBe(2);
      expect(page.limit).toBe(10);
      expect(payoutRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { merchantId: 'm1', status: PayoutStatus.PENDING, currency: 'USDC' },
          skip: 10,
          take: 10,
        }),
      );

      payoutRepo.findOne.mockResolvedValueOnce(null);
      await expect(service.findOne('m1', 'missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('Payout cancellation and bulk validation', () => {
    it('locks the owned payout, releases the reservation and removes the job', async () => {
      const { service, manager, queue } = setup();
      expect((await service.cancel('m1', 'p1')).status).toBe(PayoutStatus.CANCELLED);
      expect(manager.findOne).toHaveBeenCalledWith(expect.anything(), {
        where: { id: 'p1', merchantId: 'm1' },
        lock: { mode: 'pessimistic_write' },
      });
      expect(ACTIVE_PAYOUT_STATUSES).not.toContain(PayoutStatus.CANCELLED);
      expect(queue.getJob).toHaveBeenCalledWith('p1');
    });

    it.each([PayoutStatus.SUBMITTED, PayoutStatus.COMPLETED, PayoutStatus.FAILED])(
      'rejects cancelling %s',
      async (status) => {
        const { service, manager, queue } = setup(status);
        await expect(service.cancel('m1', 'p1')).rejects.toBeInstanceOf(
          ConflictException,
        );
        expect(manager.save).not.toHaveBeenCalled();
        expect(queue.getJob).not.toHaveBeenCalled();
      },
    );

    it('does not reveal another merchant payout', async () => {
      const { service, manager } = setup();
      manager.findOne.mockResolvedValue(null);
      await expect(service.cancel('m2', 'p1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('skips a cancelled payout when its job was already active', async () => {
      const { service } = setup();
      Object.assign(service, {
        payoutRepo: { update: jest.fn().mockResolvedValue({ affected: 0 }) },
      });
      await expect(service.process('p1')).resolves.toBeNull();
    });

    it('rejects invalid later rows before any database or queue writes', async () => {
      const { service, source, queue } = setup();
      await expect(
        service.createBulk(
          'm1',
          `${header}${destination},5,USD,one\n${destination},-1,USD,two`,
          'token',
        ),
      ).rejects.toThrow();
      expect(source.transaction).not.toHaveBeenCalled();
      expect(queue.addBulk).not.toHaveBeenCalled();
    });

    it('checks combined row amounts against the balance', async () => {
      const { service, manager, queue } = setup();
      Object.assign(manager, { query: jest.fn() });
      Object.assign(service, {
        computeBalance: jest.fn().mockResolvedValue({ available: '9' }),
        getDailyLimit: jest.fn().mockResolvedValue('100'),
        sumPayoutsSince: jest.fn().mockResolvedValue(0n),
      });
      await expect(
        service.createBulk(
          'm1',
          `${header}${destination},5,USD,one\n${destination},5,USD,two`,
          'token',
        ),
      ).rejects.toThrow('Batch exceeds');
      expect(manager.save).not.toHaveBeenCalled();
      expect(queue.addBulk).not.toHaveBeenCalled();
    });

    it('checks the whole batch against today’s remaining daily limit', async () => {
      const { service, manager, queue } = setup();
      Object.assign(manager, { query: jest.fn() });
      Object.assign(service, {
        computeBalance: jest.fn().mockResolvedValue({ available: '100' }),
        getDailyLimit: jest.fn().mockResolvedValue('10'),
        sumPayoutsSince: jest.fn().mockResolvedValue(20000000n),
      });
      await expect(
        service.createBulk(
          'm1',
          `${header}${destination},5,USD,one\n${destination},5,USD,two`,
          'token',
        ),
      ).rejects.toThrow('Batch exceeds');
      expect(queue.addBulk).not.toHaveBeenCalled();
    });

    it('commits one batch and queues every validated row with its payout id', async () => {
      const { service, manager, queue } = setup();
      manager.findOne.mockResolvedValue(null);
      Object.assign(manager, {
        query: jest.fn(),
        create: jest.fn((_entity, row) => row),
        save: jest.fn(async (rows) =>
          rows.map((row: Record<string, unknown>, i: number) => ({
            ...row,
            id: `p${i}`,
          })),
        ),
      });
      Object.assign(service, {
        computeBalance: jest.fn().mockResolvedValue({ available: '100' }),
        getDailyLimit: jest.fn().mockResolvedValue('100'),
        sumPayoutsSince: jest.fn().mockResolvedValue(0n),
      });
      const result = await service.createBulk(
        'm1',
        `${header}${destination},5,USD,one\n${destination},5,USD,two`,
        'token',
      );
      expect(result.rows).toEqual([
        { row: 2, payoutId: 'p0', reference: 'one', status: PayoutStatus.PENDING },
        { row: 3, payoutId: 'p1', reference: 'two', status: PayoutStatus.PENDING },
      ]);
      expect(queue.addBulk).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            data: { payoutId: 'p0' },
            opts: expect.objectContaining({ jobId: 'p0', attempts: 1 }),
          }),
          expect.objectContaining({ data: { payoutId: 'p1' } }),
        ]),
      );
      expect(manager.save).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ batchId: result.batchId }),
        ]),
      );
    });
  });
});
