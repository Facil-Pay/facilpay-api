import { randomUUID } from 'crypto';
import { WebhookSigningKeysService, decryptPrivateKey, encryptPrivateKey } from './webhook-signing-keys.service';
import { signBodyEd25519, verifyEd25519Signature } from './webhook-signing';

/** In-memory stand-in for the TypeORM repository, honouring the filters the service uses. */
function makeRepo() {
  const rows: any[] = [];
  return {
    rows,
    create: (value: any) => ({ ...value }),
    save: async (value: any) => {
      if (!value.id) {
        value.id = randomUUID();
        value.createdAt = new Date(Date.now() + rows.length);
        rows.push(value);
      }
      return value;
    },
    find: async ({ where, take }: any) => {
      let result = rows.filter((row) => {
        if (where.status && row.status !== where.status) return false;
        if (where.expiresAt) {
          // MoreThan(date) FindOperator
          const limit: Date = where.expiresAt.value;
          if (!row.expiresAt || row.expiresAt.getTime() <= limit.getTime()) return false;
        }
        return true;
      });
      result = [...result].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return take ? result.slice(0, take) : result;
    },
  };
}

describe('WebhookSigningKeysService', () => {
  const previousKey = process.env.WEBHOOK_SIGNING_KEYS_ENCRYPTION_KEY;
  const logger = { child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) };
  const config = { get: (_key: string, fallback: unknown) => fallback };
  let repo: ReturnType<typeof makeRepo>;
  let service: WebhookSigningKeysService;

  beforeAll(() => { process.env.WEBHOOK_SIGNING_KEYS_ENCRYPTION_KEY = 'unit-test-key'; });
  afterAll(() => {
    if (previousKey === undefined) delete process.env.WEBHOOK_SIGNING_KEYS_ENCRYPTION_KEY;
    else process.env.WEBHOOK_SIGNING_KEYS_ENCRYPTION_KEY = previousKey;
  });
  beforeEach(() => {
    repo = makeRepo();
    service = new WebhookSigningKeysService(repo as any, config as any, logger as any);
  });

  it('encrypts private keys at rest and round-trips them', () => {
    const envelope = encryptPrivateKey('-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n');
    expect(envelope).not.toContain('PRIVATE KEY');
    expect(decryptPrivateKey(envelope)).toContain('abc');
  });

  it('creates a key on first use and reuses it', async () => {
    const first = await service.getSigningKey();
    const second = await service.getSigningKey();
    expect(first.kid).toMatch(/^whk_[0-9a-f]{16}$/);
    expect(second.kid).toBe(first.kid);
    expect(repo.rows).toHaveLength(1);
    expect(repo.rows[0].privateKeyEncrypted).not.toContain('PRIVATE KEY');
  });

  it('publishes the active key and signatures verify against it', async () => {
    const key = await service.getSigningKey();
    const keys = await service.listPublicKeys();
    expect(keys).toEqual([expect.objectContaining({ kid: key.kid, status: 'active', algorithm: 'ed25519' })]);
    expect(keys[0]).not.toHaveProperty('privateKeyEncrypted');
    const header = signBodyEd25519('{"a":1}', key);
    expect(verifyEd25519Signature(header, '{"a":1}', { [keys[0].kid]: keys[0].publicKeyPem })).toBe(true);
  });

  it('keeps the old key published for the grace period after rotation', async () => {
    const old = await service.getSigningKey();
    const keys = await service.rotate(24);
    const fresh = await service.getSigningKey();
    expect(fresh.kid).not.toBe(old.kid);
    expect(keys.map((k) => [k.kid, k.status])).toEqual([[fresh.kid, 'active'], [old.kid, 'retiring']]);
    const retiring = keys.find((k) => k.kid === old.kid)!;
    expect(retiring.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);

    // Signatures made by the old key remain verifiable with the published list.
    const header = signBodyEd25519('{}', old);
    const published = Object.fromEntries(keys.map((k) => [k.kid, k.publicKeyPem]));
    expect(verifyEd25519Signature(header, '{}', published)).toBe(true);
  });

  it('stops publishing a retired key once its grace period has ended', async () => {
    const old = await service.getSigningKey();
    await service.rotate(1);
    const later = new Date(Date.now() + 2 * 3600_000);
    const keys = await service.listPublicKeys(later);
    expect(keys.map((k) => k.kid)).not.toContain(old.kid);
    expect(keys).toHaveLength(1);
  });

  it('rejects a negative grace period', async () => {
    await expect(service.rotate(-1)).rejects.toThrow('gracePeriodHours');
  });
});
