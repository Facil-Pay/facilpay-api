import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWebhookSecretRotationGrace1792700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "webhook_endpoints" ADD COLUMN "previousSecret" varchar(255) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "webhook_endpoints" ADD COLUMN "previousSecretExpiresAt" timestamptz NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "webhook_endpoints" DROP COLUMN "previousSecretExpiresAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "webhook_endpoints" DROP COLUMN "previousSecret"`,
    );
  }
}
