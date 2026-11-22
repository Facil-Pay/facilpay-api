import { createHmac } from 'crypto';

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
