import { encryptedHeadersTransformer, maskEndpoint, validateHeaders } from './header-security';

describe('Webhook custom headers', () => {
  const originalKey = process.env.WEBHOOK_HEADERS_ENCRYPTION_KEY;
  beforeEach(() => { process.env.WEBHOOK_HEADERS_ENCRYPTION_KEY = 'test-key'; });
  afterEach(() => {
    if (originalKey === undefined) delete process.env.WEBHOOK_HEADERS_ENCRYPTION_KEY;
    else process.env.WEBHOOK_HEADERS_ENCRYPTION_KEY = originalKey;
  });
  it.each(['Host', 'HOST', 'Content-Length', 'X-FacilPay-Signature', 'X-FacilPay-Event', 'Signature', 'Connection', 'Transfer-Encoding'])('rejects reserved %s', name => {
    expect(() => validateHeaders({ [name]: 'value' })).toThrow();
  });
  it.each([null, [], { 'Bad Header': 'v' }, { Authorization: 'a\r\nb' }, { A: 1 }, { A: 'a', a: 'b' }])('rejects malformed headers %p', headers => {
    expect(() => validateHeaders(headers)).toThrow();
  });
  it('encrypts values with unique nonces and decrypts losslessly', () => {
    const headers = { Authorization: 'Bearer secret' };
    const encrypted = encryptedHeadersTransformer.to(headers);
    expect(JSON.stringify(encrypted)).not.toContain('Bearer secret');
    expect(encryptedHeadersTransformer.to(headers)).not.toEqual(encrypted);
    expect(encryptedHeadersTransformer.from(encrypted)).toEqual(headers);
    expect(maskEndpoint({ headers }).headers).toEqual({ Authorization: '********' });
    expect(headers.Authorization).toBe('Bearer secret');
  });
  it('rejects tampering and missing encryption keys', () => {
    const encrypted = encryptedHeadersTransformer.to({ Authorization: 'secret' });
    encrypted.tag = Buffer.alloc(16).toString('base64');
    expect(() => encryptedHeadersTransformer.from(encrypted)).toThrow();
    delete process.env.WEBHOOK_HEADERS_ENCRYPTION_KEY;
    expect(() => encryptedHeadersTransformer.to({ A: 'secret' })).toThrow();
  });
  it('preserves unset headers without needing a key', () => {
    delete process.env.WEBHOOK_HEADERS_ENCRYPTION_KEY;
    expect(encryptedHeadersTransformer.to(null)).toBeNull();
    expect(encryptedHeadersTransformer.from(null)).toBeNull();
  });
});
