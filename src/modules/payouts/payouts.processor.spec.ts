jest.mock('../../tracing', () => ({
  getTraceId: jest.fn(),
  initializeTracing: jest.fn(),
  runWithTrace: (_name: string, fn: () => unknown) => fn(),
}));

import { Job } from 'bullmq';
import { PayoutStatus } from './entities/payout.entity';
import { PayoutsProcessor, ProcessPayoutJobData } from './payouts.processor';
import { PayoutsService } from './payouts.service';

describe('PayoutsProcessor', () => {
  let processor: PayoutsProcessor;
  let payoutsService: jest.Mocked<Pick<PayoutsService, 'process'>>;

  beforeEach(() => {
    payoutsService = {
      process: jest.fn(),
    };
    processor = new PayoutsProcessor(
      payoutsService as unknown as PayoutsService,
    );
  });

  it('delegates job processing to PayoutsService.process and returns COMPLETED status', async () => {
    payoutsService.process.mockResolvedValue({
      id: 'payout-1',
      status: PayoutStatus.COMPLETED,
    } as never);

    const job = {
      id: 'payout-1',
      data: { payoutId: 'payout-1' },
    } as Job<ProcessPayoutJobData>;

    await expect(processor.process(job)).resolves.toEqual({
      status: PayoutStatus.COMPLETED,
    });
    expect(payoutsService.process).toHaveBeenCalledWith('payout-1');
  });

  it('returns FAILED status when PayoutsService.process marks a payout as FAILED', async () => {
    payoutsService.process.mockResolvedValue({
      id: 'payout-2',
      status: PayoutStatus.FAILED,
      failureReason: 'op_underfunded',
    } as never);

    const job = {
      id: 'payout-2',
      data: { payoutId: 'payout-2' },
    } as Job<ProcessPayoutJobData>;

    await expect(processor.process(job)).resolves.toEqual({
      status: PayoutStatus.FAILED,
    });
  });

  it('returns null status when payout is no longer pending (e.g. cancelled or already claimed)', async () => {
    payoutsService.process.mockResolvedValue(null);

    const job = {
      id: 'payout-3',
      data: { payoutId: 'payout-3' },
    } as Job<ProcessPayoutJobData>;

    await expect(processor.process(job)).resolves.toEqual({ status: null });
  });

  it('logs an error when onFailed worker event fires', () => {
    const loggerErrorSpy = jest
      .spyOn((processor as unknown as { logger: { error: jest.Mock } }).logger, 'error')
      .mockImplementation(() => undefined);

    const job = {
      id: 'payout-err',
      data: { payoutId: 'payout-err' },
    } as Job<ProcessPayoutJobData>;

    processor.onFailed(job, new Error('Redis connection lost'));
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      'Payout job payout-err failed: Redis connection lost',
    );
  });
});
