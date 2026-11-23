import { MigrationInterface, QueryRunner } from 'typeorm';
export class CreateRequestLogs1795300000001 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "request_logs" (
      "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(), "merchantId" uuid NOT NULL,
      "apiKeyId" uuid NOT NULL, "method" varchar(16) NOT NULL, "path" varchar(2048) NOT NULL,
      "status" integer NOT NULL, "latencyMs" integer NOT NULL, "idempotencyKey" varchar(255),
      "requestBody" jsonb, "responseBody" jsonb, "createdAt" timestamptz NOT NULL DEFAULT now()
    )`);
    await queryRunner.query('CREATE INDEX "IDX_request_logs_merchant_created" ON "request_logs" ("merchantId", "createdAt")');
    await queryRunner.query('CREATE INDEX "IDX_request_logs_created" ON "request_logs" ("createdAt")');
  }
  async down(queryRunner: QueryRunner): Promise<void> { await queryRunner.query('DROP TABLE "request_logs"'); }
}
