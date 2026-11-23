import { randomUUID } from 'crypto';
import { OAuthClient, OAuthCredential, OAuthGrant } from '../../src/modules/auth/oauth/oauth.entity';
import { OAuthService } from '../../src/modules/auth/oauth/oauth.service';

// HTTP/unit test store only. PostgreSQL locking is exercised by deployment checks separately.
export function oauthTestStore() {
  const tables = new Map<unknown, any[]>([[OAuthClient, []], [OAuthGrant, []], [OAuthCredential, []]]);
  const matches = (row: any, where: any) => Object.entries(where).every(([key, value]: any) =>
    value && typeof value === 'object' && value._type === 'isNull' ? row[key] == null : row[key] === value);
  const repo = (entity: any): any => ({
    create: (value: any) => ({ id: randomUUID(), createdAt: new Date(), ...value }),
    save: async (value: any) => {
      const rows = tables.get(entity)!;
      const index = rows.findIndex((row) => row.id === value.id);
      if (index < 0) rows.push(value); else rows[index] = value;
      return value;
    },
    findOneBy: async (where: any) => tables.get(entity)!.find((row) => matches(row, where)) ?? null,
    find: async ({ where }: any) => tables.get(entity)!.filter((row) => matches(row, where)),
    existsBy: async (where: any) => tables.get(entity)!.some((row) => matches(row, where)),
    createQueryBuilder: () => {
      let id = '';
      const builder = { addSelect: () => builder, where: (_: string, params: any) => { id = params.id; return builder; },
        getOne: async () => tables.get(entity)!.find((row) => row.id === id && row.isActive) ?? null };
      return builder;
    },
  });
  const manager: any = {
    create: (entity: any, value: any) => repo(entity).create(value),
    save: (entity: any, value: any) => repo(entity).save(value),
    findOneBy: (entity: any, where: any) => repo(entity).findOneBy(where),
    findOne: (entity: any, options: any) => repo(entity).findOneBy(options.where),
    update: async (entity: any, where: any, values: any) => {
      for (const row of tables.get(entity)!) if (matches(row, where)) Object.assign(row, values);
    },
  };
  const users = { assertMerchantActive: jest.fn().mockResolvedValue(undefined) };
  const dataSource: any = { transaction: async (fn: any) => fn(manager) };
  const service = new OAuthService(repo(OAuthClient), repo(OAuthGrant), repo(OAuthCredential), dataSource, users as any);
  return { service, tables, users };
}
