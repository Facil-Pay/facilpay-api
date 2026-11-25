import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class AddWebhookEd25519Signatures1795400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Existing endpoints keep HMAC signing.
    await queryRunner.query(
      `ALTER TABLE "webhook_endpoints" ADD COLUMN "signatureScheme" varchar(20) NOT NULL DEFAULT 'hmac-sha256'`,
    );

    await queryRunner.createTable(
      new Table({
        name: 'webhook_signing_keys',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'gen_random_uuid()',
          },
          { name: 'kid', type: 'varchar', length: '64', isNullable: false, isUnique: true },
          { name: 'algorithm', type: 'varchar', length: '20', default: "'ed25519'", isNullable: false },
          { name: 'publicKey', type: 'text', isNullable: false },
          { name: 'privateKeyEncrypted', type: 'text', isNullable: false },
          { name: 'status', type: 'varchar', length: '16', default: "'active'", isNullable: false },
          { name: 'expiresAt', type: 'timestamptz', isNullable: true },
          { name: 'createdAt', type: 'timestamptz', default: 'now()', isNullable: false },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'webhook_signing_keys',
      new TableIndex({ name: 'IDX_webhook_signing_keys_status', columnNames: ['status'] }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('webhook_signing_keys', 'IDX_webhook_signing_keys_status');
    await queryRunner.dropTable('webhook_signing_keys');
    await queryRunner.query(`ALTER TABLE "webhook_endpoints" DROP COLUMN "signatureScheme"`);
  }
}
