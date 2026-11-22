import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class AddCustomerWallets1733000003000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'customer_wallets',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'customerId',
            type: 'uuid',
          },
          {
            name: 'address',
            type: 'varchar',
            length: '56',
          },
          {
            name: 'lastUsedAt',
            type: 'timestamptz',
            isNullable: true,
          },
          {
            name: 'createdAt',
            type: 'timestamptz',
            default: 'now()',
          },
          {
            name: 'updatedAt',
            type: 'timestamptz',
            default: 'now()',
          },
        ],
        indices: [
          {
            name: 'idx_customer_wallets_customer',
            columnNames: ['customerId'],
          },
          {
            name: 'idx_customer_wallets_customer_address',
            columnNames: ['customerId', 'address'],
            isUnique: true,
          },
        ],
        foreignKeys: [
          {
            columnNames: ['customerId'],
            referencedTableName: 'customers',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
      }),
      true,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('customer_wallets');
  }
}
