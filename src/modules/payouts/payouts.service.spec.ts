import { ConflictException, NotFoundException } from '@nestjs/common';
import { PayoutsService } from './payouts.service';
import { PayoutStatus, ACTIVE_PAYOUT_STATUSES } from './entities/payout.entity';

describe('Payout cancellation and bulk validation', () => {
  function setup(status = PayoutStatus.PENDING) {
    const payout = { id: 'p1', merchantId: 'm1', status };
    const manager = { findOne: jest.fn().mockResolvedValue(payout), save: jest.fn(async row => row) };
    const queue = { getJob: jest.fn().mockResolvedValue({ remove: jest.fn() }), addBulk: jest.fn() };
    const source = { transaction: jest.fn(async callback => callback(manager)) };
    const service = Object.assign(Object.create(PayoutsService.prototype), {
      dataSource: source, payoutsQueue: queue,
      authService: { validateStepUpToken: jest.fn() },
      usersService: { assertMerchantActive: jest.fn() },
      stellarService: { validatePayoutRecipient: jest.fn() },
      dispatchEvent: jest.fn(), logger: { warn: jest.fn() },
    }) as PayoutsService;
    return { service, manager, queue, source };
  }

  it('locks the owned payout, releases the reservation and removes the job', async () => {
    const { service, manager, queue } = setup();
    expect((await service.cancel('m1', 'p1')).status).toBe(PayoutStatus.CANCELLED);
    expect(manager.findOne).toHaveBeenCalledWith(expect.anything(), {
      where: { id: 'p1', merchantId: 'm1' }, lock: { mode: 'pessimistic_write' },
    });
    expect(ACTIVE_PAYOUT_STATUSES).not.toContain(PayoutStatus.CANCELLED);
    expect(queue.getJob).toHaveBeenCalledWith('p1');
  });

  it.each([PayoutStatus.SUBMITTED, PayoutStatus.COMPLETED, PayoutStatus.FAILED])('rejects cancelling %s', async status => {
    const { service, manager, queue } = setup(status);
    await expect(service.cancel('m1', 'p1')).rejects.toBeInstanceOf(ConflictException);
    expect(manager.save).not.toHaveBeenCalled();
    expect(queue.getJob).not.toHaveBeenCalled();
  });

  it('does not reveal another merchant payout', async () => {
    const { service, manager } = setup();
    manager.findOne.mockResolvedValue(null);
    await expect(service.cancel('m2', 'p1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('skips a cancelled payout when its job was already active', async () => {
    const { service } = setup();
    Object.assign(service, { payoutRepo: { update: jest.fn().mockResolvedValue({ affected: 0 }) } });
    await expect(service.process('p1')).resolves.toBeNull();
  });

  const destination = `G${'A'.repeat(55)}`;
  const header = 'destination,amount,currency,reference\n';
  it('rejects invalid later rows before any database or queue writes', async () => {
    const { service, source, queue } = setup();
    await expect(service.createBulk('m1', `${header}${destination},5,USD,one\n${destination},-1,USD,two`, 'token')).rejects.toThrow();
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
    await expect(service.createBulk('m1', `${header}${destination},5,USD,one\n${destination},5,USD,two`, 'token')).rejects.toThrow('Batch exceeds');
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
    await expect(service.createBulk('m1', `${header}${destination},5,USD,one\n${destination},5,USD,two`, 'token')).rejects.toThrow('Batch exceeds');
    expect(queue.addBulk).not.toHaveBeenCalled();
  });

  it('commits one batch and queues every validated row with its payout id', async () => {
    const { service, manager, queue } = setup();
    manager.findOne.mockResolvedValue(null);
    Object.assign(manager, {
      query: jest.fn(), create: jest.fn((_entity, row) => row),
      save: jest.fn(async rows => rows.map((row, i) => ({ ...row, id: `p${i}` }))),
    });
    Object.assign(service, {
      computeBalance: jest.fn().mockResolvedValue({ available: '100' }),
      getDailyLimit: jest.fn().mockResolvedValue('100'),
      sumPayoutsSince: jest.fn().mockResolvedValue(0n),
    });
    const result = await service.createBulk('m1', `${header}${destination},5,USD,one\n${destination},5,USD,two`, 'token');
    expect(result.rows).toEqual([
      { row: 2, payoutId: 'p0', reference: 'one', status: PayoutStatus.PENDING },
      { row: 3, payoutId: 'p1', reference: 'two', status: PayoutStatus.PENDING },
    ]);
    expect(queue.addBulk).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ data: { payoutId: 'p0' }, opts: expect.objectContaining({ jobId: 'p0', attempts: 1 }) }),
      expect.objectContaining({ data: { payoutId: 'p1' } }),
    ]));
    expect(manager.save).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ batchId: result.batchId })]));
  });
});
