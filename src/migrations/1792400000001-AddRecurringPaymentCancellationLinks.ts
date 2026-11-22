import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRecurringPaymentCancellationLinks1792400000001
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "recurring_payments"
      ADD COLUMN "payerCancellationEnabled" boolean NOT NULL DEFAULT true,
      ADD COLUMN "cancelTokenHash" character varying(64),
      ADD COLUMN "cancelTokenExpiresAt" timestamp,
      ADD COLUMN "cancelTokenUsedAt" timestamp
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "recurring_payments"
      DROP COLUMN "cancelTokenUsedAt",
      DROP COLUMN "cancelTokenExpiresAt",
      DROP COLUMN "cancelTokenHash",
      DROP COLUMN "payerCancellationEnabled"
    `);
  }
}