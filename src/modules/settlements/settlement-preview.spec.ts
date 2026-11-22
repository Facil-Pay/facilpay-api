import { SettlementsService } from './settlements.service';
import { MerchantSettlementConfig, SettlementSchedule } from './entities/merchant-settlement-config.entity';
import { RefundStatus } from '../payments/refund.entity';

jest.mock('../ledger/ledger-transaction', () => ({ appendLedgerTransaction: jest.fn().mockResolvedValue([]) }));

describe('Settlement preview', () => {
  afterEach(() => jest.useRealTimers());

  function setup(gross = false) {
    const config = { id: 'config', userId: 'merchant', currency: 'USD', schedule: SettlementSchedule.DAILY, reservePercent: 10, reserveDays: 7 };
    const payments = [{ id: 'payment', amount: 100, netAmount: 95, feeAmount: 5, refundedAmount: 10 }];
    const query = { where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(), getMany: jest.fn().mockResolvedValue(payments) };
    const manager = {
      createQueryBuilder: jest.fn().mockReturnValue(query),
      find: jest.fn(async entity => entity === MerchantSettlementConfig ? [config] : [
        { paymentId: 'payment', amount: 10, status: RefundStatus.PENDING },
        { paymentId: 'payment', amount: 5, status: 'PENDING_APPROVAL' },
      ]),
    };
    const source = { transaction: jest.fn(async (_isolation, callback) => callback(manager)) };
    const service = Object.assign(Object.create(SettlementsService.prototype), {
      dataSource: source, settleOnGross: gross,
    }) as SettlementsService;
    return { service, manager, config, query };
  }

  it.each([[false, 80, 8, 72], [true, 85, 8.5, 76.5]])('uses the run calculation (gross=%s)', async (gross, total, reserve, net) => {
    const { service, manager, config, query } = setup(gross as boolean);
    // Both preview and the transaction that creates a settlement call this helper.
    const actual = await (service as any).calculateSettlement(manager, config);
    const { previews } = await service.preview('merchant');
    expect(previews[0]).toMatchObject({ totalAmount: total, reservedAmount: reserve, netAmount: net, fees: 5, pendingRefunds: 15 });
    expect(previews[0].totalAmount).toBe(actual.totalAmount);
    expect(query.andWhere).toHaveBeenCalledWith('p.settlementId IS NULL');
  });

  it.each([
    [SettlementSchedule.DAILY, '2026-10-20T00:00:00.000Z'],
    [SettlementSchedule.WEEKLY, '2026-10-25T00:00:00.000Z'],
    [SettlementSchedule.MONTHLY, '2026-11-01T00:00:00.000Z'],
  ])('estimates the next %s run without writes', async (schedule, expected) => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-19T12:00:00Z'));
    const { service, config, manager } = setup();
    config.schedule = schedule;
    const result = await service.preview('merchant');
    expect((result.previews[0].nextSettlementAt as Date).toISOString()).toBe(expected);
    expect(manager.find).toHaveBeenCalledWith(MerchantSettlementConfig, { where: { userId: 'merchant' } });
    expect(result.previews[0].payments).toBeUndefined();
  });

  it('persists the same amounts in an actual run as in preview', async () => {
    const { service, config, manager, query } = setup();
    Object.assign(query, { setLock: jest.fn().mockReturnThis(), getOne: jest.fn().mockResolvedValue(config) });
    Object.assign(manager, {
      create: jest.fn((_entity, value) => value),
      save: jest.fn(async value => ({ id: 'settlement', ...value })),
      update: jest.fn(),
    });
    const runner = {
      manager, connect: jest.fn(), startTransaction: jest.fn(),
      commitTransaction: jest.fn(), rollbackTransaction: jest.fn(), release: jest.fn(),
    };
    Object.assign(config, { destinationId: 'destination' });
    Object.assign(service, {
      dataSource: {
        transaction: async (_isolation, callback) => callback(manager),
        createQueryRunner: () => runner,
      },
      usersService: { findOne: jest.fn().mockResolvedValue({ status: 'ACTIVE' }) },
      getEligibleDestination: jest.fn(), dispatchSettlementEvents: jest.fn(), sendSettlementEmail: jest.fn(),
    });
    const preview = (await service.preview('merchant')).previews[0];
    const settlement = await (service as any).processMerchantSettlement(config);
    expect(settlement).toMatchObject({ totalAmount: preview.totalAmount, reservedAmount: preview.reservedAmount, netAmount: preview.netAmount });
    expect(runner.commitTransaction).toHaveBeenCalledTimes(1);
  });
});
