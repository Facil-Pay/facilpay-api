import { MigrationInterface, QueryRunner } from 'typeorm';
export class CreateMerchantSaml1795300000002 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "merchant_saml_configs" (
      "merchantId" uuid PRIMARY KEY, "domain" varchar(253) NOT NULL UNIQUE,
      "metadataXml" text NOT NULL, "requireSso" boolean NOT NULL DEFAULT false,
      "defaultRole" varchar(20) NOT NULL DEFAULT 'VIEWER'
    )`);
    await queryRunner.query(`CREATE TABLE "saml_states" (
      "id" varchar(128) PRIMARY KEY, "merchantId" uuid NOT NULL, "value" text NOT NULL, "expiresAt" timestamptz NOT NULL
    )`);
    await queryRunner.query('CREATE INDEX "IDX_saml_states_expiry" ON "saml_states" ("expiresAt")');
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "saml_states"');
    await queryRunner.query('DROP TABLE "merchant_saml_configs"');
  }
}
