import { UnauthorizedException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';

function encryptionKey(): Buffer {
  const key = process.env.API_KEY_SIGNING_ENCRYPTION_KEY;
  if (!key) throw new Error('API_KEY_SIGNING_ENCRYPTION_KEY is required for signed API keys');
  return createHash('sha256').update(key).digest();
}

export function encryptSigningSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((v) => v.toString('base64')).join('.');
}

export function decryptSigningSecret(value: string): string {
  const [iv, tag, data] = value.split('.').map((v) => Buffer.from(v, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

export function signRequest(secret: string, method: string, path: string, timestamp: string, body: Buffer): string {
  const bodyHash = createHash('sha256').update(body).digest('hex');
  return createHmac('sha256', secret).update([method.toUpperCase(), path, timestamp, bodyHash].join('\n')).digest('hex');
}

export function verifySignedRequest(request: any, encryptedSecret: string | null, now = Date.now()): void {
  const timestamp = request.headers['x-facilpay-timestamp'];
  const signature = request.headers['x-facilpay-signature'];
  if (typeof timestamp !== 'string' || !/^\d{10}$/.test(timestamp) ||
      Math.abs(now - Number(timestamp) * 1000) > 300_000 ||
      typeof signature !== 'string' || !/^[a-fA-F0-9]{64}$/.test(signature) || !encryptedSecret) {
    throw new UnauthorizedException('Invalid or expired request signature');
  }
  // Never reserialize parsed JSON: the signature authenticates the exact wire bytes.
  const hasBody = request.body != null || Number(request.headers['content-length'] ?? 0) > 0 || request.headers['transfer-encoding'] != null;
  if (hasBody && !Buffer.isBuffer(request.rawBody)) {
    throw new UnauthorizedException('Raw request body is required for signature verification');
  }
  const expected = signRequest(decryptSigningSecret(encryptedSecret), request.method,
    request.originalUrl || request.url, timestamp, request.rawBody ?? Buffer.alloc(0));
  if (!timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'))) {
    throw new UnauthorizedException('Invalid request signature');
  }
}
