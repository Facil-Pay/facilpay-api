import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { MoreThan, Repository } from 'typeorm';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  KeyObject,
  randomBytes,
} from 'crypto';
import { Logger } from 'pino';
import { AppLogger } from '../logger/logger.service';
import { WebhookSigningKey } from './entities/webhook-signing-key.entity';

export const DEFAULT_SIGNING_KEY_GRACE_PERIOD_HOURS = 72;
const ACTIVE_KEY_CACHE_TTL_MS = 60_000;

export interface WebhookPublicKeyView {
  kid: string;
  algorithm: 'ed25519';
  status: 'active' | 'retiring';
  /** SPKI PEM public key. */
  publicKeyPem: string;
  /** Raw 32-byte Ed25519 public key, base64url encoded (JWK `x`). */
  publicKey: string;
  createdAt: Date;
  expiresAt: Date | null;
}

function encryptionKey(): Buffer {
  const secret = process.env.WEBHOOK_SIGNING_KEYS_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error(
      'WEBHOOK_SIGNING_KEYS_ENCRYPTION_KEY is required to sign webhooks with ed25519',
    );
  }
  return createHash('sha256').update(secret).digest();
}

export function encryptPrivateKey(pem: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(pem, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    data.toString('base64'),
  ].join(':');
}

export function decryptPrivateKey(value: string): string {
  const [version, iv, tag, data] = value.split(':');
  if (version !== 'v1' || !iv || !tag || !data) {
    throw new Error('Unsupported webhook signing key envelope');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(data, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

@Injectable()
export class WebhookSigningKeysService {
  private readonly logger: Logger;
  private readonly gracePeriodHours: number;
  private activeKeyCache: {
    expiresAt: number;
    value: { kid: string; privateKey: KeyObject };
  } | null = null;

  constructor(
    @InjectRepository(WebhookSigningKey)
    private readonly repo: Repository<WebhookSigningKey>,
    private readonly configService: ConfigService,
    appLogger: AppLogger,
  ) {
    this.logger = appLogger.child({ module: WebhookSigningKeysService.name });
    const graceHours = Number(
      this.configService.get(
        'WEBHOOK_SIGNING_KEY_GRACE_PERIOD_HOURS',
        DEFAULT_SIGNING_KEY_GRACE_PERIOD_HOURS,
      ),
    );
    this.gracePeriodHours =
      Number.isFinite(graceHours) && graceHours >= 0
        ? graceHours
        : DEFAULT_SIGNING_KEY_GRACE_PERIOD_HOURS;
  }

  /** Key that signs new ed25519 deliveries; created on first use. */
  async getSigningKey(): Promise<{ kid: string; privateKey: KeyObject }> {
    if (this.activeKeyCache && this.activeKeyCache.expiresAt > Date.now()) {
      return this.activeKeyCache.value;
    }
    const key = (await this.findActiveKey()) ?? (await this.createKey());
    const value = {
      kid: key.kid,
      privateKey: createPrivateKey(decryptPrivateKey(key.privateKeyEncrypted)),
    };
    this.activeKeyCache = { expiresAt: Date.now() + ACTIVE_KEY_CACHE_TTL_MS, value };
    return value;
  }

  /** Active key plus retiring keys whose grace period has not ended. */
  async listPublicKeys(now: Date = new Date()): Promise<WebhookPublicKeyView[]> {
    const [active, retiring] = await Promise.all([
      this.repo.find({ where: { status: 'active' }, order: { createdAt: 'DESC' } }),
      this.repo.find({
        where: { status: 'retiring', expiresAt: MoreThan(now) },
        order: { createdAt: 'DESC' },
      }),
    ]);
    return [...active, ...retiring].map((key) => this.toView(key));
  }

  /**
   * Generates a new signing key. Existing active keys become `retiring` and
   * stay published for `gracePeriodHours` (default
   * WEBHOOK_SIGNING_KEY_GRACE_PERIOD_HOURS) so receivers can keep verifying
   * signatures they produced.
   */
  async rotate(gracePeriodHours?: number): Promise<WebhookPublicKeyView[]> {
    const graceHours = gracePeriodHours ?? this.gracePeriodHours;
    if (!Number.isFinite(graceHours) || graceHours < 0) {
      throw new BadRequestException('gracePeriodHours must be a non-negative number');
    }
    const expiresAt = new Date(Date.now() + graceHours * 3600_000);
    const previous = await this.repo.find({ where: { status: 'active' } });
    for (const key of previous) {
      key.status = 'retiring';
      key.expiresAt = expiresAt;
      await this.repo.save(key);
    }
    const created = await this.createKey();
    this.activeKeyCache = null;
    this.logger.info(
      { kid: created.kid, retired: previous.map((key) => key.kid), graceHours },
      'Webhook signing key rotated',
    );
    return this.listPublicKeys();
  }

  private async findActiveKey(): Promise<WebhookSigningKey | null> {
    const [key] = await this.repo.find({
      where: { status: 'active' },
      order: { createdAt: 'DESC' },
      take: 1,
    });
    return key ?? null;
  }

  private async createKey(): Promise<WebhookSigningKey> {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const key = this.repo.create({
      kid: `whk_${randomBytes(8).toString('hex')}`,
      algorithm: 'ed25519',
      publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      privateKeyEncrypted: encryptPrivateKey(
        privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      ),
      status: 'active',
      expiresAt: null,
    });
    return this.repo.save(key);
  }

  private toView(key: WebhookSigningKey): WebhookPublicKeyView {
    const jwk = createPublicKey(key.publicKey).export({ format: 'jwk' }) as {
      x?: string;
    };
    return {
      kid: key.kid,
      algorithm: 'ed25519',
      status: key.status,
      publicKeyPem: key.publicKey,
      publicKey: jwk.x ?? '',
      createdAt: key.createdAt,
      expiresAt: key.expiresAt,
    };
  }
}
