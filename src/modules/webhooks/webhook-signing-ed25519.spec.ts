import { generateKeyPairSync } from 'crypto';
import {
  parseEd25519SignatureHeader,
  signBodyEd25519,
  verifyEd25519Signature,
} from './webhook-signing';

const body = JSON.stringify({ event: 'payment.completed', data: { id: 'p1' } });
const now = new Date('2026-11-25T12:00:00.000Z');

function keyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    privateKey,
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

describe('ed25519 webhook signing', () => {
  const active = keyPair();
  const other = keyPair();

  it('produces a header carrying the timestamp, key id and signature', () => {
    const header = signBodyEd25519(body, { kid: 'whk_a', privateKey: active.privateKey }, now);
    const parsed = parseEd25519SignatureHeader(header);
    expect(parsed).toEqual({
      timestamp: Math.floor(now.getTime() / 1000),
      kid: 'whk_a',
      signature: expect.any(String),
    });
  });

  it('verifies with the published public key for the kid', () => {
    const header = signBodyEd25519(body, { kid: 'whk_a', privateKey: active.privateKey }, now);
    expect(verifyEd25519Signature(header, body, { whk_a: active.publicPem }, now)).toBe(true);
  });

  it('rejects a tampered body, an unknown kid, the wrong key and a stale timestamp', () => {
    const header = signBodyEd25519(body, { kid: 'whk_a', privateKey: active.privateKey }, now);
    expect(verifyEd25519Signature(header, `${body} `, { whk_a: active.publicPem }, now)).toBe(false);
    expect(verifyEd25519Signature(header, body, { whk_b: active.publicPem }, now)).toBe(false);
    expect(verifyEd25519Signature(header, body, { whk_a: other.publicPem }, now)).toBe(false);
    const later = new Date(now.getTime() + 301_000);
    expect(verifyEd25519Signature(header, body, { whk_a: active.publicPem }, later)).toBe(false);
  });

  it('rejects malformed headers', () => {
    expect(parseEd25519SignatureHeader('abc')).toBeNull();
    expect(parseEd25519SignatureHeader('t=1,kid=x')).toBeNull();
    expect(verifyEd25519Signature('t=x,kid=a,ed25519=b', body, { a: active.publicPem }, now)).toBe(false);
  });
});
