import { encryptSigningSecret, signRequest, verifySignedRequest } from './request-signing';
import { ApiKeyAuthGuard } from './api-key-auth.guard';

describe('API request signing', () => {
  const secret = 'separate-signing-secret';
  const timestamp = '1795300000';
  const now = Number(timestamp) * 1000;
  let encrypted: string;
  const previousKey = process.env.API_KEY_SIGNING_ENCRYPTION_KEY;
  beforeAll(() => {
    process.env.API_KEY_SIGNING_ENCRYPTION_KEY = 'test-encryption-key';
    encrypted = encryptSigningSecret(secret);
  });
  afterAll(() => {
    if (previousKey === undefined) delete process.env.API_KEY_SIGNING_ENCRYPTION_KEY;
    else process.env.API_KEY_SIGNING_ENCRYPTION_KEY = previousKey;
  });
  function request() {
    const rawBody = Buffer.from('{ "amount": 100 }');
    return { method: 'POST', originalUrl: '/v1/payments?mode=test', body: { amount: 100 }, rawBody,
      headers: { 'x-facilpay-timestamp': timestamp,
        'x-facilpay-signature': signRequest(secret, 'POST', '/v1/payments?mode=test', timestamp, rawBody) } };
  }
  it('accepts exact wire bytes and keeps the secret encrypted', () => {
    expect(encrypted).not.toContain(secret);
    expect(() => verifySignedRequest(request(), encrypted, now)).not.toThrow();
  });
  it.each([-300_001, 300_001])('rejects timestamps outside the five minute window (%s ms)', (offset) => {
    expect(() => verifySignedRequest(request(), encrypted, now + offset)).toThrow('Invalid or expired');
  });
  it.each(['method', 'path', 'body'])('rejects modified %s', (field) => {
    const req = request();
    if (field === 'method') req.method = 'DELETE';
    if (field === 'path') req.originalUrl = '/v1/payments';
    if (field === 'body') req.rawBody = Buffer.from('{"amount":100}');
    expect(() => verifySignedRequest(req, encrypted, now)).toThrow('Invalid request signature');
  });
  it('rejects malformed signatures without a buffer length error', () => {
    const req = request(); req.headers['x-facilpay-signature'] = 'bad';
    expect(() => verifySignedRequest(req, encrypted, now)).toThrow('Invalid or expired');
  });
  it('requires raw bytes when a parsed body exists', () => {
    const req: any = request(); delete req.rawBody;
    expect(() => verifySignedRequest(req, encrypted, now)).toThrow('Raw request body');
  });
  it('enforces signatures in the API key guard', async () => {
    const keys = { validateKey: jest.fn().mockResolvedValue({ userId: 'merchant', requireSignedRequests: true, signingSecretEncrypted: encrypted }) };
    const guard = new ApiKeyAuthGuard(keys as any, { get: jest.fn() } as any,
      { get: jest.fn() } as any, { assertMerchantActive: jest.fn() } as any);
    const req = { headers: { 'x-api-key': 'leaked-api-key' } };
    await expect(guard.canActivate({ switchToHttp: () => ({ getRequest: () => req }), getHandler: () => ({}) } as any)).rejects.toThrow('Invalid or expired');
  });
});
