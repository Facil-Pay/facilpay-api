import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNameToUsers1706300000000 implements MigrationInterface {
  name = 'AddNameToUsers1706300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "name" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "name"`);
  }
}
