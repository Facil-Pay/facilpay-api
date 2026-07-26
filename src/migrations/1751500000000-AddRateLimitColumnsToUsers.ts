import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddRateLimitColumnsToUsers1751500000000 implements MigrationInterface {
  name = 'AddRateLimitColumnsToUsers1751500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumns('users', [
      new TableColumn({
        name: 'rateLimitEnabled',
        type: 'boolean',
        default: false,
      }),
      new TableColumn({
        name: 'rateLimitLimit',
        type: 'integer',
        isNullable: true,
      }),
      new TableColumn({
        name: 'rateLimitTtl',
        type: 'integer',
        isNullable: true,
      }),
    ]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumns('users', [
      'rateLimitEnabled',
      'rateLimitLimit',
      'rateLimitTtl',
    ]);
  }
}