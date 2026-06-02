import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddAccountLockoutToUsers1706100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'users',
      new TableColumn({
        name: 'failedLoginAttempts',
        type: 'integer',
        default: 0,
      }),
    );

    await queryRunner.addColumn(
      'users',
      new TableColumn({
        name: 'lockedUntil',
        type: 'timestamp',
        nullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('users', 'lockedUntil');
    await queryRunner.dropColumn('users', 'failedLoginAttempts');
  }
}
