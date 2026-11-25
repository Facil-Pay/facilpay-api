import {
  createHmac,
  createPublicKey,
  KeyObject,
  sign as cryptoSign,
  verify as cryptoVerify,
} from 'crypto';

export interface SigningSecrets {
  secret: string;
  previousSecret?: string | null;
  previousSecretExpiresAt?: Date | string | null;
}

/** True while the previous secret is still inside its rotation grace period. */
export function isPreviousSecretActive(
  endpoint: SigningSecrets,
  now: Date = new Date(),
): boolean {
  return (
    !!endpoint.previousSecret &&
    !!endpoint.previousSecretExpiresAt &&
    new Date(endpoint.previousSecretExpiresAt).getTime() > now.getTime()
  );
}

/**
 * Value for the X-FacilPay-Signature header: the HMAC-SHA256 hex digest of the
 * body for the current secret, followed by a comma and the digest for the
 * previous secret while its grace period is open. Receivers accept the
 * delivery when any of the comma-separated digests matches.
 */
export function signBody(
  body: string,
  endpoint: SigningSecrets,
  now: Date = new Date(),
): string {
  const secrets = [endpoint.secret];
  if (isPreviousSecretActive(endpoint, now)) {
    secrets.push(endpoint.previousSecret as string);
  }
  return secrets
    .map((secret) => createHmac('sha256', secret).update(body).digest('hex'))
    .join(',');
}

export const WEBHOOK_SIGNATURE_SCHEMES = ['hmac-sha256', 'ed25519'] as const;
export type WebhookSignatureScheme = (typeof WEBHOOK_SIGNATURE_SCHEMES)[number];
export const DEFAULT_SIGNATURE_SCHEME: WebhookSignatureScheme = 'hmac-sha256';

/** Default tolerance receivers should apply to the `t=` timestamp. */
export const ED25519_SIGNATURE_TOLERANCE_SECONDS = 300;

export interface Ed25519SigningKey {
  kid: string;
  privateKey: KeyObject | string;
}

/** Bytes signed for an Ed25519 delivery: `<timestamp>.<raw body>`. */
export function ed25519SignedPayload(timestamp: number, body: string): Buffer {
  return Buffer.from(`${timestamp}.${body}`, 'utf8');
}

/**
 * Value for the X-FacilPay-Signature header on endpoints using the `ed25519`
 * scheme: `t=<unix seconds>,kid=<key id>,ed25519=<base64url signature>`.
 */
export function signBodyEd25519(
  body: string,
  key: Ed25519SigningKey,
  now: Date = new Date(),
): string {
  const timestamp = Math.floor(now.getTime() / 1000);
  const signature = cryptoSign(
    null,
    ed25519SignedPayload(timestamp, body),
    key.privateKey,
  ).toString('base64url');
  return `t=${timestamp},kid=${key.kid},ed25519=${signature}`;
}

export interface ParsedEd25519Signature {
  timestamp: number;
  kid: string;
  signature: string;
}

export function parseEd25519SignatureHeader(
  header: string,
): ParsedEd25519Signature | null {
  const parts = new Map<string, string>();
  for (const part of header.split(',')) {
    const index = part.indexOf('=');
    if (index <= 0) return null;
    parts.set(part.slice(0, index).trim(), part.slice(index + 1).trim());
  }
  const timestamp = Number(parts.get('t'));
  const kid = parts.get('kid');
  const signature = parts.get('ed25519');
  if (!Number.isInteger(timestamp) || !kid || !signature) return null;
  return { timestamp, kid, signature };
}

/**
 * Receiver-side check, used by tests and mirrored in docs/WEBHOOKS.md.
 * `publicKeys` maps key IDs to SPKI PEM public keys from
 * `GET /v1/webhooks/public-keys`.
 */
export function verifyEd25519Signature(
  header: string,
  body: string,
  publicKeys: Record<string, string | KeyObject>,
  now: Date = new Date(),
  toleranceSeconds: number = ED25519_SIGNATURE_TOLERANCE_SECONDS,
): boolean {
  const parsed = parseEd25519SignatureHeader(header);
  if (!parsed) return false;
  const publicKey = publicKeys[parsed.kid];
  if (!publicKey) return false;
  if (Math.abs(Math.floor(now.getTime() / 1000) - parsed.timestamp) > toleranceSeconds) {
    return false;
  }
  try {
    return cryptoVerify(
      null,
      ed25519SignedPayload(parsed.timestamp, body),
      typeof publicKey === 'string' ? createPublicKey(publicKey) : publicKey,
      Buffer.from(parsed.signature, 'base64url'),
    );
  } catch {
    return false;
  }
}
