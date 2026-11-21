import { DataSource } from 'typeorm';
import {
  buildCsv,
  DatabaseExportsSource,
  EXPORT_COLUMNS,
  ExportType,
  AccountingAccountMappings,
  buildAccountingEntries,
  buildQuickBooksCsv,
  buildQuickBooksIif,
  buildXeroCsv,
  sanitizeCsvCell,
} from './exports.service';

describe('exports source', () => {
  it.each<ExportType>([
    'payments',
    'customers',
    'invoices',
    'refunds',
    'ledger',
  ])(
    'streams merchant-scoped %s rows with its documented columns',
    async (resource) => {
      const query = jest.fn().mockResolvedValue([{ id: 'row-id' }]);
      const source = new DatabaseExportsSource({ query } as unknown as DataSource);
      const batches: Record<string, unknown>[][] = [];

      for await (const batch of source.streamRows(
        resource,
        { merchantId: 'merchant-id', currency: 'USD' },
        100,
      )) {
        batches.push(batch);
      }

      expect(batches).toEqual([[{ id: 'row-id' }]]);
      const sql = query.mock.calls[0][0];
      const merchantPredicate = {
        payments: 'p."merchantId" = $1',
        customers: 'c."merchantId" = $1',
        invoices: 'i."merchantId" = $1',
        refunds: 'p."merchantId" = $1',
        ledger: 'l."merchantId" = $1',
      }[resource];
      expect(sql).toContain(`WHERE ${merchantPredicate}`);
      expect(query.mock.calls[0][1][0]).toBe('merchant-id');
      expect(sql).toContain('LIMIT');
      for (const column of EXPORT_COLUMNS[resource]) {
        expect(sql).toContain(`"${column}"`);
      }
    },
  );

  it('applies invoice currency filters to the invoices table', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const source = new DatabaseExportsSource({ query } as unknown as DataSource);

    for await (const _batch of source.streamRows(
      'invoices',
      { merchantId: 'merchant-id', currency: 'USD' },
      100,
    )) {
      // No rows expected for this query.
    }

    expect(query.mock.calls[0][0]).toContain('i."currency" = $2');
    expect(query.mock.calls[0][1]).toEqual(['merchant-id', 'USD', 100, 0]);
  });

  it('applies ledger currency and date filters to the ledger table', async () => {
    const query = jest
      .fn<Promise<Record<string, unknown>[]>, [string, unknown[]]>()
      .mockResolvedValue([]);
    const source = new DatabaseExportsSource({
      query,
    } as unknown as DataSource);
    const batches: Record<string, unknown>[][] = [];

    for await (const batch of source.streamRows(
      'ledger',
      {
        merchantId: 'merchant-id',
        currency: 'USD',
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-02-01T00:00:00.000Z',
      },
      100,
    )) {
      batches.push(batch);
    }

    const [sql, params] = query.mock.calls[0];
    expect(batches).toEqual([]);
    expect(sql).toContain('FROM "ledger_entries" l');
    expect(sql).toContain('l."createdAt" >= $2');
    expect(sql).toContain('l."createdAt" < $3');
    expect(sql).toContain('l."currency" = $4');
    expect(params).toEqual([
      'merchant-id',
      '2026-01-01T00:00:00.000Z',
      '2026-02-01T00:00:00.000Z',
      'USD',
      100,
      0,
    ]);
  });

  it('streams accounting events from merchant-scoped payments, refunds, and payouts', async () => {
    const query = jest
      .fn<Promise<Record<string, unknown>[]>, [string, unknown[]]>()
      .mockResolvedValue([]);
    const source = new DatabaseExportsSource({ query } as unknown as DataSource);

    for await (const _batch of source.streamRows(
      'xero_csv',
      {
        merchantId: 'merchant-id',
        currency: 'USD',
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-02-01T00:00:00.000Z',
      },
      100,
    )) {
      // No rows expected for this query.
    }

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('FROM "payments" p');
    expect(sql).toContain('FROM "refunds" r');
    expect(sql).toContain('FROM "payouts" py');
    expect(sql).toContain('p."merchantId" = $1');
    expect(sql).toContain('py."merchantId" = $1');
    expect(sql).toContain('accounting."date" >= $2');
    expect(sql).toContain('accounting."date" < $3');
    expect(params).toEqual([
      'merchant-id',
      '2026-01-01T00:00:00.000Z',
      '2026-02-01T00:00:00.000Z',
      'USD',
      100,
      0,
    ]);
  });

  it('keeps signed numbers and dates usable in CSV while still neutralising formulas', () => {
    expect(sanitizeCsvCell('-92.50000000')).toBe('-92.50000000');
    expect(sanitizeCsvCell('-1+1')).toBe("'-1+1");
    expect(sanitizeCsvCell('+5')).toBe("'+5");
    expect(sanitizeCsvCell(new Date('2026-01-05T10:00:00.000Z'))).toBe(
      '2026-01-05T10:00:00.000Z',
    );
    expect(buildCsv(['id', 'amount'], [{ id: '@cmd', amount: '-3.10' }])).toBe(
      "id,amount\n'@cmd,-3.10\n",
    );
  });

  it('protects formula-leading values and escapes CSV delimiters', () => {
    expect(sanitizeCsvCell('=SUM(A1:A2)')).toBe("'=SUM(A1:A2)");
    expect(sanitizeCsvCell('name,"value"')).toBe('"name,""value"""');
    expect(sanitizeCsvCell(null)).toBe('');
  });

  it('creates balanced accounting entries for payments, fees, refunds, and payouts', () => {
    const mappings: AccountingAccountMappings = {
      quickbooks: {
        payments: 'Sales',
        fees: 'Fees',
        refunds: 'Refunds',
        payouts: 'Payouts',
        clearing: 'Clearing',
      },
      xero: {
        payments: '4000',
        fees: '6100',
        refunds: '4050',
        payouts: '1010',
        clearing: '1020',
      },
    };
    const entries = buildAccountingEntries(
      [
        {
          id: 'payment-1',
          date: '2026-01-03T00:00:00.000Z',
          type: 'PAYMENT',
          reference: 'order-1',
          description: 'Payment',
          amount: '100.00',
          feeAmount: '3.00',
          netAmount: '97.00',
          currency: 'USD',
        },
        {
          id: 'refund-1',
          date: '2026-01-04T00:00:00.000Z',
          type: 'REFUND',
          reference: 'refund-1',
          description: 'Refund',
          amount: '10.00',
          currency: 'USD',
        },
        {
          id: 'payout-1',
          date: '2026-01-05T00:00:00.000Z',
          type: 'PAYOUT',
          reference: 'payout-1',
          description: 'Payout',
          amount: '20.00',
          currency: 'USD',
        },
      ],
      mappings.xero,
    );

    expect(entries.map(({ account, amount }) => [account, amount])).toEqual([
      ['1020', '97.00'],
      ['6100', '3.00'],
      ['4000', '-100.00'],
      ['4050', '10.00'],
      ['1020', '-10.00'],
      ['1010', '20.00'],
      ['1020', '-20.00'],
    ]);
    expect(entries.slice(0, 3).reduce((sum, entry) => sum + Number(entry.amount), 0)).toBe(0);
  });

  it('serializes the journal entries to the QuickBooks IIF and CSV and Xero CSV formats', () => {
    const sourceRows = [
      {
        id: 'payment-1',
        date: '2026-01-03T00:00:00.000Z',
        type: 'PAYMENT',
        reference: 'order-1',
        description: 'Payment',
        amount: '100.00',
        feeAmount: '3.00',
        netAmount: '97.00',
        currency: 'USD',
      },
    ];
    const quickbooksEntries = buildAccountingEntries(sourceRows, {
      payments: 'Sales',
      fees: 'Fees',
      refunds: 'Refunds',
      payouts: 'Payouts',
      clearing: 'Clearing',
    });
    const xeroEntries = buildAccountingEntries(sourceRows, {
      payments: '4000',
      fees: '6100',
      refunds: '4050',
      payouts: '1010',
      clearing: '1020',
    });

    const iif = buildQuickBooksIif(quickbooksEntries);
    expect(iif).toContain('!TRNS\tTRNSTYPE\tDATE\tACCNT\tAMOUNT');
    expect(iif).toContain('TRNS\tGENERAL JOURNAL\t01/03/2026\tClearing\t97.00');
    expect(iif).toContain('SPL\tGENERAL JOURNAL\t01/03/2026\tSales\t-100.00');
    expect(iif.match(/ENDTRNS/g)).toHaveLength(2);
    expect(buildQuickBooksCsv(quickbooksEntries)).toContain('Journal No.,Journal Date,Account Name,Debits,Credits');
    expect(buildXeroCsv(xeroEntries)).toContain('*Narration,*Date,*AccountCode,*TaxRate,*Amount');
    expect(buildXeroCsv(xeroEntries)).toContain('payment-1,2026-01-03,1020,No VAT,97.00');
  });

  it('persists accounting mappings by merchant', async () => {
    const mappings: AccountingAccountMappings = {
      quickbooks: {
        payments: 'Sales',
        fees: 'Fees',
        refunds: 'Refunds',
        payouts: 'Payouts',
        clearing: 'Clearing',
      },
      xero: {
        payments: '4000',
        fees: '6100',
        refunds: '4050',
        payouts: '1010',
        clearing: '1020',
      },
    };
    const query = jest.fn().mockResolvedValue([{ mappings }]);
    const source = new DatabaseExportsSource({ query } as unknown as DataSource);

    await expect(source.getAccountMappings('merchant-1')).resolves.toEqual(mappings);
    expect(query).toHaveBeenLastCalledWith(
      'SELECT "mappings" FROM "merchant_account_mappings" WHERE "merchantId" = $1',
      ['merchant-1'],
    );

    await expect(
      source.saveAccountMappings('merchant-1', mappings),
    ).resolves.toEqual(mappings);
    expect(query.mock.calls[1][0]).toContain('ON CONFLICT ("merchantId") DO UPDATE');
    expect(query.mock.calls[1][1]).toEqual(['merchant-1', JSON.stringify(mappings)]);
  });
});