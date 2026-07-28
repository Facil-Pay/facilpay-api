import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInitiatedByToRefunds1753700000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "refunds" ADD COLUMN "initiatedBy" varchar`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "refunds" DROP COLUMN "initiatedBy"`,
    );
  }
}
