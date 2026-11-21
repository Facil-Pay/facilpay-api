import { createHash } from 'crypto';
import * as StellarSdk from '@stellar/stellar-sdk';

/**
 * Derives a deterministic uint64 muxed ID from a payment UUID.
 *
 * Masked to 63 bits so the value stays within the range every Stellar SDK and
 * JSON consumer handles safely. Using the payment ID as seed means the same
 * payment always yields the same deposit address, even if generation is retried.
 */
export function deriveMuxedId(paymentId: string): string {
  const digest = createHash('sha256').update(`muxed:${paymentId}`).digest();
  return (digest.readBigUInt64BE(0) & 0x7fffffffffffffffn).toString();
}

/**
 * Encodes a (base G... account, muxed ID) pair as a muxed M... address.
 */
export function buildMuxedAddress(
  baseAccount: string,
  muxedId: string,
): string {
  return new StellarSdk.MuxedAccount(
    new StellarSdk.Account(baseAccount, '0'),
    muxedId,
  ).accountId();
}

/**
 * Returns the base G... account behind a muxed M... address.
 */
export function extractBaseAccount(muxedAddress: string): string {
  return StellarSdk.MuxedAccount.fromAddress(muxedAddress, '0')
    .baseAccount()
    .accountId();
}

export function isValidMuxedAddress(address: string): boolean {
  return StellarSdk.StrKey.isValidMed25519PublicKey(address);
}

export function isValidBaseAccount(address: string): boolean {
  return StellarSdk.StrKey.isValidEd25519PublicKey(address);
}
