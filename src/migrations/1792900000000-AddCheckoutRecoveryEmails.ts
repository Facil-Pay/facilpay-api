import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCheckoutRecoveryEmails1792900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "merchant_settings" ADD COLUMN IF NOT EXISTS "recoveryEmailsEnabled" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "merchant_settings" ADD COLUMN IF NOT EXISTS "recoveryEmailDelayMinutes" integer NOT NULL DEFAULT 60`,
    );
    await queryRunner.query(
      `ALTER TABLE "checkout_sessions" ADD COLUMN IF NOT EXISTS "recoveryEmailSentAt" timestamp NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "checkout_sessions" ADD COLUMN IF NOT EXISTS "recoveredFromId" uuid NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_checkout_sessions_recovery" ON "checkout_sessions" ("status", "recoveryEmailSentAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_checkout_sessions_recovery"`,
    );
    await queryRunner.query(
      `ALTER TABLE "checkout_sessions" DROP COLUMN IF EXISTS "recoveredFromId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "checkout_sessions" DROP COLUMN IF EXISTS "recoveryEmailSentAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "merchant_settings" DROP COLUMN IF EXISTS "recoveryEmailDelayMinutes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "merchant_settings" DROP COLUMN IF EXISTS "recoveryEmailsEnabled"`,
    );
  }
}
