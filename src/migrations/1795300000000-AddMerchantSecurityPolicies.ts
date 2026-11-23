import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMerchantSecurityPolicies1795300000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "merchant_settings"
      ADD "apiKeyInactivityDays" integer,
      ADD "require2fa" boolean NOT NULL DEFAULT false,
      ADD CONSTRAINT "CHK_api_key_inactivity_days" CHECK ("apiKeyInactivityDays" BETWEEN 8 AND 3650)`);
    await queryRunner.query(`ALTER TABLE "api_keys"
      ADD "inactivityWarningAt" timestamptz,
      ADD "inactivityRevokeAt" timestamptz`);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "api_keys" DROP "inactivityRevokeAt", DROP "inactivityWarningAt"');
    await queryRunner.query('ALTER TABLE "merchant_settings" DROP CONSTRAINT "CHK_api_key_inactivity_days", DROP "require2fa", DROP "apiKeyInactivityDays"');
  }
}
