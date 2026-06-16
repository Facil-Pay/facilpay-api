import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPaymentIndexes1706400000000 implements MigrationInterface {
  name = 'AddPaymentIndexes1706400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_payments_status" ON "payments" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_payments_created_at" ON "payments" ("createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_payments_external_reference" ON "payments" ("externalReference")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_payments_external_reference"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_payments_created_at"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_payments_status"`);
  }
}
