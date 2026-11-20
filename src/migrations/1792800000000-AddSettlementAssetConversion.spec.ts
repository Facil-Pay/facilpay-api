import { AddSettlementAssetConversion1792800000000 } from './1792800000000-AddSettlementAssetConversion';

describe('AddSettlementAssetConversion migration', () => {
  it('adds every conversion column and drops exactly the same columns on revert', async () => {
    const migration = new AddSettlementAssetConversion1792800000000();
    const statements: string[] = [];
    const queryRunner = {
      query: jest.fn(async (sql: string) => {
        statements.push(sql);
      }),
    } as any;

    await migration.up(queryRunner);
    const added = statements
      .filter((sql) => sql.includes('ADD COLUMN'))
      .map((sql) => /ADD COLUMN "([^"]+)"/.exec(sql)?.[1]);

    expect(added).toHaveLength(10);
    expect(added).toEqual(
      expect.arrayContaining([
        'settlementAsset',
        'maxSlippagePercent',
        'sourceAsset',
        'sourceAmount',
        'destAmount',
        'conversionRate',
        'slippagePercent',
        'conversionFee',
        'conversionTransactionHash',
      ]),
    );

    statements.length = 0;
    await migration.down(queryRunner);
    const dropped = statements
      .filter((sql) => sql.includes('DROP COLUMN'))
      .map((sql) => /DROP COLUMN "([^"]+)"/.exec(sql)?.[1]);

    expect(dropped).toHaveLength(added.length);
    expect([...dropped].sort()).toEqual([...added].sort());
  });
});
