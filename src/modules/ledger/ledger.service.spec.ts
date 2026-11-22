import { BadRequestException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { LedgerService, LEDGER_CSV_SYNC_ROW_LIMIT } from './ledger.service';
import {
  LedgerAccount,
  LedgerEntry,
  LedgerReferenceType,
} from './ledger-entry.entity';
import { GetLedgerEntriesDto } from './dto/get-ledger-entries.dto';

describe('LedgerService', () => {
  let service: LedgerService;
  let queryBuilder: Record<string, jest.Mock>;

  beforeEach(() => {
    queryBuilder = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      addGroupBy: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      having: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([]),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      getMany: jest.fn().mockResolvedValue([]),
    };
    const repository = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    };
    service = new LedgerService(
      repository as unknown as Repository<LedgerEntry>,
    );
  });

  it('groups balances by currency and account', async () => {
    queryBuilder.getRawMany.mockResolvedValueOnce([
      {
        currency: 'USD',
        account: LedgerAccount.AVAILABLE,
        balance: '92.50000000',
      },
      { currency: 'USD', account: LedgerAccount.FEES, balance: '7.50000000' },
    ]);

    const result = await service.getBalance('merchant-1', 'usd');

    expect(queryBuilder.where).toHaveBeenCalledWith(
      'entry.merchantId = :merchantId',
      { merchantId: 'merchant-1' },
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'entry.currency = :currency',
      { currency: 'USD' },
    );
    expect(result).toEqual({
      merchantId: 'merchant-1',
      balances: [
        {
          currency: 'USD',
          account: LedgerAccount.AVAILABLE,
          balance: '92.50000000',
        },
        {
          currency: 'USD',
          account: LedgerAccount.FEES,
          balance: '7.50000000',
        },
      ],
    });
  });

  it('filters and paginates ledger entries for the merchant', async () => {
    const entries = [{ id: 'entry-1' }];
    queryBuilder.getManyAndCount.mockResolvedValueOnce([entries, 1]);
    const dto: GetLedgerEntriesDto = {
      page: 2,
      limit: 10,
      currency: 'EUR',
      account: LedgerAccount.AVAILABLE,
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-12-31T23:59:59.999Z',
    };

    const result = await service.findLedger('merchant-1', dto);

    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'entry.currency = :currency',
      { currency: 'EUR' },
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'entry.account = :account',
      { account: LedgerAccount.AVAILABLE },
    );
    expect(queryBuilder.skip).toHaveBeenCalledWith(10);
    expect(queryBuilder.take).toHaveBeenCalledWith(10);
    expect(result).toEqual({ data: entries, total: 1, page: 2, limit: 10 });
  });

  describe('exportCsv', () => {
    const range = {
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-01-31T23:59:59.999Z',
    };

    const entry = (overrides: Partial<LedgerEntry>): LedgerEntry =>
      ({
        id: 'entry-1',
        merchantId: 'merchant-1',
        currency: 'USD',
        account: LedgerAccount.AVAILABLE,
        amount: '92.50000000',
        referenceType: LedgerReferenceType.PAYMENT,
        referenceId: 'payment-1',
        transactionId: 'transaction-1',
        createdAt: new Date('2026-01-05T10:00:00.000Z'),
        ...overrides,
      }) as LedgerEntry;

    it('renders the documented columns oldest first for the merchant and range', async () => {
      queryBuilder.getMany.mockResolvedValueOnce([
        entry({}),
        entry({
          id: 'entry-2',
          account: LedgerAccount.FEES,
          amount: '-7.50000000',
        }),
      ]);

      const csv = await service.exportCsv('merchant-1', {
        page: 1,
        limit: 20,
        currency: 'usd',
        ...range,
      });

      expect(queryBuilder.where).toHaveBeenCalledWith(
        'entry.merchantId = :merchantId',
        { merchantId: 'merchant-1' },
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'entry.createdAt >= :from',
        { from: new Date(range.from) },
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'entry.createdAt <= :to',
        { to: new Date(range.to) },
      );
      expect(queryBuilder.orderBy).toHaveBeenCalledWith(
        'entry.createdAt',
        'ASC',
      );
      expect(csv).toBe(
        [
          'id,createdAt,currency,account,amount,referenceType,referenceId,transactionId',
          'entry-1,2026-01-05T10:00:00.000Z,USD,AVAILABLE,92.50000000,PAYMENT,payment-1,transaction-1',
          'entry-2,2026-01-05T10:00:00.000Z,USD,FEES,-7.50000000,PAYMENT,payment-1,transaction-1',
          '',
        ].join('\n'),
      );
    });

    it('neutralises formula characters in text columns but keeps signed amounts numeric', async () => {
      queryBuilder.getMany.mockResolvedValueOnce([
        entry({
          referenceType: LedgerReferenceType.ADJUSTMENT,
          referenceId: '=HYPERLINK("http://evil.example","pay")',
          amount: '-12.00000000',
        }),
      ]);

      const csv = await service.exportCsv('merchant-1', { ...range } as never);
      const row = csv.split('\n')[1];

      expect(row).toContain(`"'=HYPERLINK(""http://evil.example"",""pay"")"`);
      expect(row).toContain(',-12.00000000,');
    });

    it('requires a date range and rejects an inverted one', async () => {
      await expect(
        service.exportCsv('merchant-1', { from: range.from } as never),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.exportCsv('merchant-1', {
          from: range.to,
          to: range.from,
        } as never),
      ).rejects.toThrow(BadRequestException);
      expect(queryBuilder.getMany).not.toHaveBeenCalled();
    });

    it('refuses ranges too large to build inline and points to the background export', async () => {
      queryBuilder.getMany.mockResolvedValueOnce(
        Array.from({ length: LEDGER_CSV_SYNC_ROW_LIMIT + 1 }, (_, i) =>
          entry({ id: `entry-${i}` }),
        ),
      );

      const attempt = service.exportCsv('merchant-1', { ...range } as never);

      await expect(attempt).rejects.toThrow(/POST \/v1\/exports/);
      expect(queryBuilder.take).toHaveBeenCalledWith(
        LEDGER_CSV_SYNC_ROW_LIMIT + 1,
      );
    });
  });

  it('reports unbalanced transactions from the consistency query', async () => {
    queryBuilder.getRawMany.mockResolvedValueOnce([
      { transactionId: 'transaction-1', amount: '0.01' },
    ]);

    const report = await service.checkConsistency();

    expect(queryBuilder.having).toHaveBeenCalledWith('SUM(entry.amount) <> 0');
    expect(report.unbalancedTransactions).toEqual([
      { transactionId: 'transaction-1', amount: '0.01' },
    ]);
  });

  it('schedules the consistency check', async () => {
    const checkConsistency = jest
      .spyOn(service, 'checkConsistency')
      .mockResolvedValue({ checkedAt: new Date(), unbalancedTransactions: [] });

    await service.scheduledConsistencyCheck();

    expect(checkConsistency).toHaveBeenCalledTimes(1);
  });
});
