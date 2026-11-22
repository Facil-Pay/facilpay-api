import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPayoutCancellationAndBatch1792368000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TYPE "payouts_status_enum" ADD VALUE IF NOT EXISTS 'CANCELLED'`);
    await runner.query(`ALTER TABLE "payouts" ADD COLUMN "batchId" uuid`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE "payouts" DROP COLUMN "batchId"`);
    // Retain the enum value to preserve existing cancelled records.
  }
}
