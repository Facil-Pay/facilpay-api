import { ApiKeysService } from './api-keys.service';
import { decryptSigningSecret } from './request-signing';

describe('API key signing settings', () => {
  let repo: any;
  let service: ApiKeysService;
  const previousKey = process.env.API_KEY_SIGNING_ENCRYPTION_KEY;
  beforeEach(() => {
    process.env.API_KEY_SIGNING_ENCRYPTION_KEY = 'test-signing-storage-key';
    repo = { create: jest.fn((v) => ({ id: 'key', ...v })), save: jest.fn(async (v) => ({ ...v })), findOne: jest.fn() };
    service = new ApiKeysService(repo, {} as any, {} as any, { record: jest.fn() } as any, {} as any);
  });
  afterAll(() => {
    if (previousKey === undefined) delete process.env.API_KEY_SIGNING_ENCRYPTION_KEY;
    else process.env.API_KEY_SIGNING_ENCRYPTION_KEY = previousKey;
  });
  it('returns an independent signing secret once and stores only ciphertext', async () => {
    const result = await service.create('merchant', { name: 'Signed key', requireSignedRequests: true });
    expect(result.signingSecret).toBeDefined();
    expect(result.signingSecret).not.toBe(result.plaintext);
    const persisted = repo.save.mock.calls[0][0];
    expect(decryptSigningSecret(persisted.signingSecretEncrypted)).toBe(result.signingSecret);
    expect(result.apiKey).not.toHaveProperty('signingSecretEncrypted');
  });
  it('can enable signing for an existing key', async () => {
    repo.findOne.mockResolvedValue({ id: 'key', userId: 'merchant', requireSignedRequests: false });
    const result = await service.update('key', 'merchant', { requireSignedRequests: true });
    expect(result.requireSignedRequests).toBe(true);
    expect(result.signingSecret).toBeDefined();
    expect(result).not.toHaveProperty('signingSecretEncrypted');
  });
  it('rotates the signing secret while preserving the signed-request requirement', async () => {
    repo.findOne.mockResolvedValue({ id: 'old', userId: 'merchant', requireSignedRequests: true, name: 'Signed key' });
    const result = await service.rotate('old', 'merchant');
    expect(repo.save.mock.calls[0][0].isActive).toBe(false);
    expect(result.apiKey.requireSignedRequests).toBe(true);
    expect(result.signingSecret).toBeDefined();
    expect(result.apiKey).not.toHaveProperty('signingSecretEncrypted');
  });
  it('does not revoke a working key when signing encryption is not configured', async () => {
    repo.findOne.mockResolvedValue({ id: 'old', userId: 'merchant', requireSignedRequests: true });
    delete process.env.API_KEY_SIGNING_ENCRYPTION_KEY;
    await expect(service.rotate('old', 'merchant')).rejects.toThrow('API_KEY_SIGNING_ENCRYPTION_KEY');
    expect(repo.save).not.toHaveBeenCalled();
  });
});
