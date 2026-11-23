import { FindOperator } from 'typeorm';
import { randomUUID } from 'crypto';
// Minimal repository adapter for HTTP tests. Production services and validation remain real.
export class SecurityStore {
  private tables = new Map<unknown, any[]>();
  rows(entity: unknown): any[] {
    if (!this.tables.has(entity)) this.tables.set(entity, []);
    return this.tables.get(entity)!;
  }
  matches(row: any, where: any): boolean {
    if (Array.isArray(where)) return where.some(item => this.matches(row, item));
    return Object.entries(where ?? {}).every(([key, expected]) => {
      if (expected instanceof FindOperator) {
        if (expected.type === 'in') return expected.value.includes(row[key]);
        if (expected.type === 'moreThan') return row[key] > expected.value;
        if (expected.type === 'moreThanOrEqual') return row[key] >= expected.value;
        if (expected.type === 'lessThan') return row[key] < expected.value;
      }
      return row[key] === expected;
    });
  }
  getRepository(entity: unknown): any {
    const rows = this.rows(entity);
    const matches = (row: any, where: any) => this.matches(row, where);
    return {
      create: (value: any) => Object.assign(new (entity as any)(), value),
      findOneBy: async (where: any) => rows.find(row => matches(row, where)) ?? null,
      findOne: async ({ where }: any) => rows.find(row => matches(row, where)) ?? null,
      findBy: async (where: any) => rows.filter(row => matches(row, where)),
      existsBy: async (where: any) => rows.some(row => matches(row, where)),
      save: async (value: any) => {
        value.id ??= randomUUID(); value.createdAt ??= new Date();
        const index = rows.findIndex(row => row.id === value.id);
        if (index < 0) rows.push(value); else rows[index] = value;
        return value;
      },
      insert: async (value: any) => {
        if (value.id && rows.some(row => row.id === value.id)) throw new Error('duplicate');
        value.id ??= randomUUID(); rows.push(value); return { identifiers: [{ id: value.id }] };
      },
      update: async (where: any, value: any) => { const found = rows.filter(row => matches(row, where)); found.forEach(row => Object.assign(row, value)); return { affected: found.length }; },
      delete: async (where: any) => { const found = rows.filter(row => matches(row, where)); found.forEach(row => rows.splice(rows.indexOf(row), 1)); return { affected: found.length }; },
    };
  }
  async findOneOrFail(entity: unknown, options: any) {
    const row = await this.getRepository(entity).findOne(options);
    if (!row) throw new Error('not found'); return row;
  }
  async transaction<T>(callback: (manager: any) => Promise<T>): Promise<T> { return callback(this); }
}
