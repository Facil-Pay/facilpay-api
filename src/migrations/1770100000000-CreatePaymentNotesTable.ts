import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePaymentNotesTable1770100000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "payment_notes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "paymentId" uuid NOT NULL,
        "authorId" character varying(255) NOT NULL,
        "body" text NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_payment_notes" PRIMARY KEY ("id"),
        CONSTRAINT "FK_payment_notes_paymentId_payments" FOREIGN KEY ("paymentId")
          REFERENCES "payments"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_payment_notes_paymentId_createdAt"
      ON "payment_notes" ("paymentId", "createdAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "IDX_payment_notes_paymentId_createdAt"`,
    );
    await queryRunner.query(`DROP TABLE "payment_notes"`);
  }
}