import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class CreateRecurringPaymentsTable1754100000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'recurring_payments',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'amount',
            type: 'decimal',
            precision: 10,
            scale: 2,
          },
          {
            name: 'currency',
            type: 'varchar',
          },
          {
            name: 'interval',
            type: 'enum',
            enum: ['daily', 'weekly', 'monthly'],
          },
          {
            name: 'status',
            type: 'enum',
            enum: ['active', 'paused', 'cancelled'],
            default: `'active'`,
          },
          {
            name: 'description',
            type: 'varchar',
            isNullable: true,
          },
          {
            name: 'merchantId',
            type: 'varchar',
            isNullable: true,
          },
          {
            name: 'merchantEmail',
            type: 'varchar',
            isNullable: true,
          },
          {
            name: 'payerEmail',
            type: 'varchar',
            isNullable: true,
          },
          {
            name: 'callbackUrl',
            type: 'varchar',
            length: '2048',
            isNullable: true,
          },
          {
            name: 'metadata',
            type: 'jsonb',
            isNullable: true,
          },
          {
            name: 'createdBy',
            type: 'varchar',
          },
          {
            name: 'nextRunAt',
            type: 'timestamp',
          },
          {
            name: 'lastRunAt',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'cancelledAt',
            type: 'timestamp',
            isNullable: true,
          },
          {
            name: 'createdAt',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updatedAt',
            type: 'timestamp',
            default: 'CURRENT_TIMESTAMP',
            onUpdate: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
      true,
    );

    await queryRunner.query(
      `CREATE INDEX "idx_recurring_payments_due" ON "recurring_payments" ("status", "nextRunAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('recurring_payments');
  }
}
