import { DataSource, QueryRunner } from 'typeorm';
import { LedgerService } from './ledger.service';

// An isolated PostgreSQL session verifies real AT TIME ZONE and DST behavior.
const databaseUrl = process.env.TEST_DATABASE_URL;
(databaseUrl ? describe : describe.skip)('Balance history PostgreSQL boundaries', () => {
  let source: DataSource;
  let runner: QueryRunner;
  let service: LedgerService;

  beforeAll(async () => {
    source = await new DataSource({ type: 'postgres', url: databaseUrl }).initialize();
    runner = source.createQueryRunner();
    await runner.connect();
    await runner.query(`CREATE TEMP TABLE ledger_entries (
      "merchantId" text, currency text, account text, amount numeric(20,8), "createdAt" timestamptz
    )`);
    service = new LedgerService({ manager: {
      findOne: async () => ({ timezone: 'America/New_York' }),
      query: (sql: string, params: unknown[]) => runner.query(sql, params),
    } } as any);
  });
  afterAll(async () => { await runner?.release(); await source?.destroy(); });

  it('carries the opening balance, fills empty days and excludes exact next midnight across spring DST', async () => {
    await runner.query(`INSERT INTO ledger_entries VALUES
      ('spring','USD','AVAILABLE',10,'2026-03-07T12:00:00Z'),
      ('spring','USD','AVAILABLE',5,'2026-03-09T03:59:59Z'),
      ('spring','USD','AVAILABLE',7,'2026-03-09T04:00:00Z'),
      ('other','USD','AVAILABLE',999,'2026-03-08T12:00:00Z')`);
    const result = await service.getHistory('spring', { from: '2026-03-08', to: '2026-03-10' });
    expect(result.days).toEqual([
      { date: '2026-03-08', currency: 'USD', balance: '15.00000000' },
      { date: '2026-03-09', currency: 'USD', balance: '22.00000000' },
      { date: '2026-03-10', currency: 'USD', balance: '22.00000000' },
    ]);
  });

  it('includes both repeated hours during the 25-hour autumn day', async () => {
    await runner.query(`INSERT INTO ledger_entries VALUES
      ('fall','USD','AVAILABLE',2,'2026-11-01T05:30:00Z'),
      ('fall','USD','AVAILABLE',3,'2026-11-01T06:30:00Z'),
      ('fall','USD','AVAILABLE',4,'2026-11-02T04:59:59Z'),
      ('fall','USD','AVAILABLE',8,'2026-11-02T05:00:00Z')`);
    const result = await service.getHistory('fall', { from: '2026-11-01', to: '2026-11-02' });
    expect(result.days).toEqual([
      { date: '2026-11-01', currency: 'USD', balance: '9.00000000' },
      { date: '2026-11-02', currency: 'USD', balance: '17.00000000' },
    ]);
  });
});
