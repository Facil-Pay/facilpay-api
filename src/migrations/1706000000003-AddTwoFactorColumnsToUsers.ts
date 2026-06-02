import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddTwoFactorColumnsToUsers1706000000003 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumns('users', [
      new TableColumn({
        name: 'twoFactorSecret',
        type: 'text',
        isNullable: true,
      }),
      new TableColumn({
        name: 'twoFactorEnabled',
        type: 'boolean',
        default: false,
      }),
    ]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('users', 'twoFactorEnabled');
    await queryRunner.dropColumn('users', 'twoFactorSecret');
  }
}
