import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRefreshTokenFamilyId1706500000000 implements MigrationInterface {
  name = 'AddRefreshTokenFamilyId1706500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "refresh_tokens" ADD COLUMN IF NOT EXISTS "familyId" uuid`,
    );
    await queryRunner.query(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_refresh_tokens_family" ON "refresh_tokens" ("userId", "familyId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_refresh_tokens_family"`);
    await queryRunner.query(`ALTER TABLE "refresh_tokens" DROP COLUMN IF EXISTS "familyId"`);
  }
}
