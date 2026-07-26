import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class CreatePaymentSplitsTable1751500000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "payments_status_enum" ADD VALUE 'PARTIALLY_COMPLETED'`,
    );

    await queryRunner.createTable(
      new Table({
        name: 'payment_splits',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'paymentId',
            type: 'uuid',
          },
          {
            name: 'recipientAddress',
            type: 'varchar',
          },
          {
            name: 'percentage',
            type: 'decimal',
            precision: 5,
            scale: 2,
          },
          {
            name: 'amount',
            type: 'decimal',
            precision: 10,
            scale: 2,
          },
          {
            name: 'status',
            type: 'enum',
            enum: ['PENDING', 'COMPLETED', 'FAILED'],
            default: `'PENDING'`,
          },
          {
            name: 'stellarTransactionHash',
            type: 'varchar',
            isNullable: true,
          },
          {
            name: 'failureReason',
            type: 'varchar',
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
      `CREATE INDEX "idx_payment_splits_payment" ON "payment_splits" ("paymentId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('payment_splits');
    // Note: PostgreSQL doesn't support removing enum values easily
  }
}
