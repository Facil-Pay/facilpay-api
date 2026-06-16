import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateStellarSettlementsTable1706800000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "stellar_settlements_status_enum" AS ENUM (
        'PENDING',
        'SUBMITTED',
        'CONFIRMED',
        'FAILED'
      );

      CREATE TABLE "stellar_settlements" (
        "id"                 UUID                                   NOT NULL DEFAULT uuid_generate_v4(),
        "paymentId"          UUID                                   NOT NULL,
        "destinationAddress" VARCHAR                                NOT NULL,
        "xlmAmount"          VARCHAR                                NOT NULL,
        "status"             "stellar_settlements_status_enum"      NOT NULL DEFAULT 'PENDING',
        "transactionHash"    VARCHAR,
        "ledger"             INTEGER,
        "errorMessage"       TEXT,
        "memo"               VARCHAR,
        "createdAt"          TIMESTAMPTZ                            NOT NULL DEFAULT now(),
        CONSTRAINT "PK_stellar_settlements" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_stellar_settlements_payment_id" UNIQUE ("paymentId")
      );

      CREATE UNIQUE INDEX "idx_stellar_settlements_payment_id" ON "stellar_settlements" ("paymentId");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS "stellar_settlements";
      DROP TYPE IF EXISTS "stellar_settlements_status_enum";
    `);
  }
}
