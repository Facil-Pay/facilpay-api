import {
  buildMuxedAddress,
  deriveMuxedId,
  extractBaseAccount,
  isValidBaseAccount,
  isValidMuxedAddress,
} from './muxed-account.util';

const BASE_ACCOUNT = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';

describe('muxed-account.util', () => {
  it('derives a deterministic uint64 ID from a payment ID', () => {
    const first = deriveMuxedId('123e4567-e89b-12d3-a456-426614174000');
    const second = deriveMuxedId('123e4567-e89b-12d3-a456-426614174000');
    const other = deriveMuxedId('123e4567-e89b-12d3-a456-426614174001');

    expect(first).toBe(second);
    expect(first).not.toBe(other);
    expect(first).toMatch(/^\d+$/);
    expect(BigInt(first) <= 0x7fffffffffffffffn).toBe(true);
  });

  it('encodes a base account and ID as an M-address that resolves back', () => {
    const muxedId = deriveMuxedId('payment-1');
    const address = buildMuxedAddress(BASE_ACCOUNT, muxedId);

    expect(isValidMuxedAddress(address)).toBe(true);
    expect(address.startsWith('M')).toBe(true);
    expect(extractBaseAccount(address)).toBe(BASE_ACCOUNT);
  });

  it('validates base G-addresses', () => {
    expect(isValidBaseAccount(BASE_ACCOUNT)).toBe(true);
    expect(isValidBaseAccount('not-an-account')).toBe(false);
    expect(isValidBaseAccount('')).toBe(false);
  });
});
