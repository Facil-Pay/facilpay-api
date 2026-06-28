import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateApiKeysTable1751200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE api_key_scope AS ENUM ('read', 'write', 'admin')`);
    await queryRunner.query(`CREATE TYPE api_key_environment AS ENUM ('live', 'test')`);

    await queryRunner.createTable(
      new Table({
        name: 'api_keys',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          { name: 'name', type: 'varchar', length: '255', isNullable: false },
          { name: 'keyHash', type: 'varchar', length: '64', isNullable: false, isUnique: true },
          { name: 'keyPrefix', type: 'varchar', length: '12', isNullable: false },
          { name: 'userId', type: 'uuid', isNullable: false },
          { name: 'scope', type: 'api_key_scope', default: `'read'` },
          { name: 'environment', type: 'api_key_environment', default: `'live'` },
          { name: 'expiresAt', type: 'timestamp', isNullable: true },
          { name: 'lastUsedAt', type: 'timestamp', isNullable: true },
          { name: 'isActive', type: 'boolean', default: true },
          { name: 'createdAt', type: 'timestamp', default: 'now()' },
          { name: 'updatedAt', type: 'timestamp', default: 'now()' },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'api_keys',
      new TableIndex({ name: 'IDX_api_keys_userId', columnNames: ['userId'] }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('api_keys');
    await queryRunner.query(`DROP TYPE IF EXISTS api_key_scope`);
    await queryRunner.query(`DROP TYPE IF EXISTS api_key_environment`);
  }
}
