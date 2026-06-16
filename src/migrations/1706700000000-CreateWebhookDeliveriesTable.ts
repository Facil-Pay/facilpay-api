import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWebhookDeliveriesTable1706700000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "webhook_deliveries_eventtype_enum" AS ENUM (
        'payment.created',
        'payment.completed',
        'payment.failed',
        'payment.cancelled',
        'payment.refunded'
      );

      CREATE TYPE "webhook_deliveries_status_enum" AS ENUM (
        'PENDING',
        'SUCCESS',
        'FAILED',
        'EXHAUSTED'
      );

      CREATE TABLE "webhook_deliveries" (
        "id"             UUID                                  NOT NULL DEFAULT uuid_generate_v4(),
        "paymentId"      UUID                                  NOT NULL,
        "url"            VARCHAR                               NOT NULL,
        "eventType"      "webhook_deliveries_eventtype_enum"   NOT NULL,
        "payload"        JSONB                                 NOT NULL,
        "status"         "webhook_deliveries_status_enum"      NOT NULL DEFAULT 'PENDING',
        "attemptCount"   INTEGER                               NOT NULL DEFAULT 0,
        "maxAttempts"    INTEGER                               NOT NULL DEFAULT 5,
        "lastHttpStatus" INTEGER,
        "lastError"      TEXT,
        "nextRetryAt"    TIMESTAMPTZ,
        "lastAttemptAt"  TIMESTAMPTZ,
        "createdAt"      TIMESTAMPTZ                           NOT NULL DEFAULT now(),
        "updatedAt"      TIMESTAMPTZ                           NOT NULL DEFAULT now(),
        CONSTRAINT "PK_webhook_deliveries" PRIMARY KEY ("id")
      );

      CREATE INDEX "idx_webhook_deliveries_payment_id" ON "webhook_deliveries" ("paymentId");
      CREATE INDEX "idx_webhook_deliveries_status"     ON "webhook_deliveries" ("status");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS "webhook_deliveries";
      DROP TYPE IF EXISTS "webhook_deliveries_status_enum";
      DROP TYPE IF EXISTS "webhook_deliveries_eventtype_enum";
    `);
  }
}
