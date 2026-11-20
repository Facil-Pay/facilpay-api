import { QueryRunner } from 'typeorm';
import { AddCheckoutSessionShipping1792800000000 } from '../1792800000000-AddCheckoutSessionShipping';

describe('AddCheckoutSessionShipping migration', () => {
  it('adds every column and drops every column on revert', async () => {
    const migration = new AddCheckoutSessionShipping1792800000000();
    const executed: string[] = [];
    const queryRunner = {
      query: jest.fn((sql: string) => {
        executed.push(sql);
        return Promise.resolve([]);
      }),
    } as unknown as QueryRunner;

    const upCount = executed.length;
    await migration.up(queryRunner);
    const upQueries = executed.slice(upCount);

    expect(upQueries).toHaveLength(6);
    expect(upQueries.join('\n')).toContain(
      'checkout_sessions ADD COLUMN "shippingAddressCollection"',
    );
    expect(upQueries.join('\n')).toContain(
      'customers ADD COLUMN "shippingAddress"',
    );

    const downStart = executed.length;
    await migration.down(queryRunner);
    const downQueries = executed.slice(downStart);

    expect(downQueries).toHaveLength(6);
    expect(downQueries.join('\n')).toContain(
      'checkout_sessions DROP COLUMN "shippingAmount"',
    );
    expect(downQueries.join('\n')).toContain(
      'customers DROP COLUMN "shippingAddress"',
    );

    const addedColumns = upQueries
      .map((sql) => sql.match(/ADD COLUMN "([^"]+)"/)?.[1])
      .filter(Boolean)
      .sort();
    const droppedColumns = downQueries
      .map((sql) => sql.match(/DROP COLUMN "([^"]+)"/)?.[1])
      .filter(Boolean)
      .sort();
    expect(addedColumns).toEqual(droppedColumns);
  });
});
