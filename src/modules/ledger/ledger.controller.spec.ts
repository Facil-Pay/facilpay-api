import { LedgerController } from './ledger.controller';
import { LedgerAccount } from './ledger-entry.entity';
import { LedgerService } from './ledger.service';
import { User } from '../users/user.entity';
import { GetLedgerEntriesDto } from './dto/get-ledger-entries.dto';
import type { Response } from 'express';

describe('LedgerController', () => {
  it('scopes balance and ledger requests to the authenticated merchant', async () => {
    const service = {
      getBalance: jest.fn().mockResolvedValue({ balances: [] }),
      findLedger: jest.fn().mockResolvedValue({ data: [] }),
    };
    const res = { set: jest.fn() } as unknown as Response;
    const controller = new LedgerController(
      service as unknown as LedgerService,
    );
    const user = { id: 'merchant-1' } as unknown as User;

    await controller.getBalance(user, 'usd');
    await controller.findLedger(
      user,
      {
        page: 1,
        limit: 20,
        account: LedgerAccount.AVAILABLE,
      } as GetLedgerEntriesDto,
      res,
    );

    expect(service.getBalance).toHaveBeenCalledWith('merchant-1', 'usd');
    expect(service.findLedger).toHaveBeenCalledWith('merchant-1', {
      page: 1,
      limit: 20,
      account: LedgerAccount.AVAILABLE,
    });
    expect(res.set).not.toHaveBeenCalled();
  });

  it('serves format=csv as a downloadable text/csv attachment', async () => {
    const service = {
      findLedger: jest.fn(),
      exportCsv: jest.fn().mockResolvedValue('id,createdAt\n'),
    };
    const res = { set: jest.fn() } as unknown as Response;
    const controller = new LedgerController(
      service as unknown as LedgerService,
    );
    const dto = {
      format: 'csv',
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-01-31T00:00:00.000Z',
    } as GetLedgerEntriesDto;

    const body = await controller.findLedger(
      { id: 'merchant-1' } as unknown as User,
      dto,
      res,
    );

    expect(body).toBe('id,createdAt\n');
    expect(service.exportCsv).toHaveBeenCalledWith('merchant-1', dto);
    expect(service.findLedger).not.toHaveBeenCalled();
    expect(res.set).toHaveBeenCalledWith({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="ledger-export.csv"',
    });
  });
});
