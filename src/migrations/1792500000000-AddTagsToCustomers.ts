import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTagsToCustomers1792500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "customers" ADD COLUMN "tags" text[] NOT NULL DEFAULT '{}'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_customers_tags" ON "customers" USING GIN ("tags")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_customers_tags"`);
    await queryRunner.query(`ALTER TABLE "customers" DROP COLUMN "tags"`);
  }
}
