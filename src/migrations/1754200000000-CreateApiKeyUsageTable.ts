import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateApiKeyUsageTable1754200000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'api_key_usage',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'apiKeyId',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'endpoint',
            type: 'varchar',
            length: '500',
            isNullable: false,
          },
          {
            name: 'method',
            type: 'varchar',
            length: '10',
            isNullable: false,
          },
          {
            name: 'sourceIp',
            type: 'varchar',
            length: '45',
            isNullable: true,
          },
          {
            name: 'userAgent',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'statusCode',
            type: 'int',
            isNullable: true,
          },
          {
            name: 'createdAt',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'api_key_usage',
      new TableIndex({
        name: 'IDX_api_key_usage_apiKeyId',
        columnNames: ['apiKeyId'],
      }),
    );

    await queryRunner.createIndex(
      'api_key_usage',
      new TableIndex({
        name: 'IDX_api_key_usage_createdAt',
        columnNames: ['createdAt'],
      }),
    );

    await queryRunner.query(`
      ALTER TABLE "api_key_usage"
      ADD CONSTRAINT "FK_api_key_usage_apiKey"
      FOREIGN KEY ("apiKeyId")
      REFERENCES "api_keys"("id")
      ON DELETE CASCADE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('api_key_usage');
  }
}
