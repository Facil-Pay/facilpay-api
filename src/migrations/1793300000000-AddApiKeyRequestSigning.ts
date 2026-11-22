import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddApiKeyRequestSigning1793300000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "api_keys" ADD "requireSignedRequests" boolean NOT NULL DEFAULT false, ADD "signingSecretEncrypted" text`);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "api_keys" DROP COLUMN "signingSecretEncrypted", DROP COLUMN "requireSignedRequests"`);
  }
}
