import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreatePhoneVerificationsTable1732291200000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'phone_verifications',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'userId',
            type: 'uuid',
            isNullable: false,
          },
          {
            name: 'phoneNumber',
            type: 'varchar',
            length: '20',
            isNullable: false,
          },
          {
            name: 'verified',
            type: 'boolean',
            default: false,
          },
          {
            name: 'verificationCode',
            type: 'varchar',
            length: '6',
            isNullable: true,
          },
          {
            name: 'codeExpiresAt',
            type: 'timestamptz',
            isNullable: true,
          },
          {
            name: 'verificationAttempts',
            type: 'integer',
            default: 0,
          },
          {
            name: 'createdAt',
            type: 'timestamptz',
            default: 'now()',
          },
          {
            name: 'updatedAt',
            type: 'timestamptz',
            default: 'now()',
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'phone_verifications',
      new TableIndex({
        name: 'IDX_phone_verifications_userId',
        columnNames: ['userId'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex(
      'phone_verifications',
      'IDX_phone_verifications_userId',
    );
    await queryRunner.dropTable('phone_verifications');
  }
}
