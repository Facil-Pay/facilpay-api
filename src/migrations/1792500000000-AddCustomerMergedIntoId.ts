import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCustomerMergedIntoId1792500000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE customers ADD COLUMN "mergedIntoId" uuid NULL REFERENCES customers(id) ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_customers_mergedIntoId" ON customers ("mergedIntoId") WHERE "mergedIntoId" IS NOT NULL`,
    );
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX "IDX_customers_mergedIntoId"');
    await queryRunner.query('ALTER TABLE customers DROP COLUMN "mergedIntoId"');
  }
}
