import { LedgerService } from './ledger.service';

describe('Balance history', () => {
  function setup() {
    const manager = {
      findOne: jest.fn().mockResolvedValue({ timezone: 'America/New_York' }),
      query: jest.fn().mockResolvedValue([{ date: '2026-03-08', currency: 'USD', balance: '10.00000000' }]),
    };
    const service = new LedgerService({ manager } as any);
    return { service, manager };
  }

  it('scopes history and cache to merchant, timezone and range', async () => {
    const { service, manager } = setup();
    const range = { from: '2026-03-08', to: '2026-03-09' };
    const first = await service.getHistory('one', range);
    expect(first.timezone).toBe('America/New_York');
    await service.getHistory('one', range);
    expect(manager.query).toHaveBeenCalledTimes(1);
    await service.getHistory('two', range);
    expect(manager.query).toHaveBeenCalledTimes(2);
    expect(manager.query).toHaveBeenLastCalledWith(expect.any(String), ['two', range.from, range.to, 'America/New_York']);
    manager.findOne.mockResolvedValue({ timezone: 'Asia/Tokyo' });
    await service.getHistory('one', range);
    expect(manager.query).toHaveBeenCalledTimes(3);
  });

  it.each([
    { from: '2026-02-30', to: '2026-03-01' },
    { from: '2026-10-20', to: '2026-10-19' },
    { from: '2024-01-01', to: '2026-01-01' },
  ])('rejects invalid ranges before querying', async range => {
    const { service, manager } = setup();
    await expect(service.getHistory('one', range)).rejects.toThrow();
    expect(manager.query).not.toHaveBeenCalled();
  });
});
