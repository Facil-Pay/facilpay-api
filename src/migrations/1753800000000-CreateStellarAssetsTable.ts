import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class CreateStellarAssetsTable1753800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'stellar_assets',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'merchantId',
            type: 'uuid',
          },
          {
            name: 'assetCode',
            type: 'varchar',
          },
          {
            name: 'assetIssuer',
            type: 'varchar',
          },
          {
            name: 'isAccepted',
            type: 'boolean',
            default: true,
          },
          {
            name: 'trustlineAddedAt',
            type: 'timestamp with time zone',
            isNullable: true,
          },
          {
            name: 'createdAt',
            type: 'timestamp with time zone',
            default: 'now()',
          },
          {
            name: 'updatedAt',
            type: 'timestamp with time zone',
            default: 'now()',
          },
        ],
        indices: [
          {
            name: 'IDX_stellar_assets_merchantId',
            columnNames: ['merchantId'],
          },
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('stellar_assets');
  }
}
