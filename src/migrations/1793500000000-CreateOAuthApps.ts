import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOAuthApps1793500000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE "oauth_clients" (
      "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(), "developerId" uuid NOT NULL,
      "name" varchar(255) NOT NULL, "secretHash" varchar NOT NULL,
      "redirectUris" text[] NOT NULL, "scopes" text[] NOT NULL,
      "isActive" boolean NOT NULL DEFAULT true, "createdAt" timestamp NOT NULL DEFAULT now())`);
    await q.query(`CREATE TABLE "oauth_grants" (
      "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      "clientId" uuid NOT NULL REFERENCES "oauth_clients"("id") ON DELETE CASCADE,
      "merchantId" uuid NOT NULL, "scopes" text[] NOT NULL, "revokedAt" timestamptz,
      "createdAt" timestamp NOT NULL DEFAULT now())`);
    await q.query(`CREATE INDEX "IDX_oauth_grants_merchant" ON "oauth_grants" ("merchantId")`);
    await q.query(`CREATE TABLE "oauth_credentials" (
      "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(), "tokenHash" varchar(64) NOT NULL UNIQUE,
      "kind" varchar(16) NOT NULL CHECK ("kind" IN ('code', 'access', 'refresh')),
      "grantId" uuid NOT NULL REFERENCES "oauth_grants"("id") ON DELETE CASCADE,
      "expiresAt" timestamptz NOT NULL, "consumedAt" timestamptz,
      "redirectUri" text, "codeChallenge" varchar(43))`);
    await q.query(`CREATE INDEX "IDX_oauth_credentials_grant" ON "oauth_credentials" ("grantId")`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "oauth_credentials"`);
    await q.query(`DROP TABLE "oauth_grants"`);
    await q.query(`DROP TABLE "oauth_clients"`);
  }
}
