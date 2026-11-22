import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEventDestinationsAndRestHooks1793400000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "webhook_endpoints"
      ADD "destinationType" varchar(20) NOT NULL DEFAULT 'http',
      ADD "destinationArn" varchar(2048), ADD "roleArn" varchar(2048),
      ADD "isRestHook" boolean NOT NULL DEFAULT false,
      ADD CONSTRAINT "CHK_webhook_destination_type" CHECK ("destinationType" IN ('http', 'sqs', 'eventbridge'))`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "webhook_endpoints" DROP CONSTRAINT "CHK_webhook_destination_type",
      DROP COLUMN "isRestHook", DROP COLUMN "roleArn", DROP COLUMN "destinationArn", DROP COLUMN "destinationType"`);
  }
}
