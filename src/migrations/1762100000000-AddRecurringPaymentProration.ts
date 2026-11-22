import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRecurringPaymentProration1762100000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "recurring_payments"
      ADD COLUMN "pendingProrationAmount" decimal(10, 2),
      ADD COLUMN "prorationBaseAmount" decimal(10, 2)
    `);
    await queryRunner.query(`
      ALTER TABLE "recurring_payment_charges"
      ADD COLUMN "prorationAmount" decimal(10, 2) NOT NULL DEFAULT 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "recurring_payment_charges"
      DROP COLUMN "prorationAmount"
    `);
    await queryRunner.query(`
      ALTER TABLE "recurring_payments"
      DROP COLUMN "prorationBaseAmount",
      DROP COLUMN "pendingProrationAmount"
    `);
  }
}