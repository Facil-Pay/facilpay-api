import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWebhookDeliveryResponseBody1792600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "webhook_deliveries" ADD COLUMN "lastResponseBody" text NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_webhook_deliveries_endpoint_created" ON "webhook_deliveries" ("endpointId", "createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "idx_webhook_deliveries_endpoint_created"`,
    );
    await queryRunner.query(
      `ALTER TABLE "webhook_deliveries" DROP COLUMN "lastResponseBody"`,
    );
  }
}
