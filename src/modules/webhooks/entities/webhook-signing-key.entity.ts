import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export type WebhookSigningKeyStatus = 'active' | 'retiring';

/**
 * Platform-wide Ed25519 key pair used to sign deliveries for endpoints whose
 * `signatureScheme` is `ed25519`. Only the newest `active` key signs; a
 * `retiring` key stays published until `expiresAt` so receivers can still
 * verify signatures it produced.
 */
@Entity('webhook_signing_keys')
@Index('IDX_webhook_signing_keys_status', ['status'])
export class WebhookSigningKey {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 64, unique: true })
  kid: string;

  @Column({ type: 'varchar', length: 20, default: 'ed25519' })
  algorithm: 'ed25519';

  /** SPKI PEM-encoded public key. */
  @Column({ type: 'text' })
  publicKey: string;

  /** AES-256-GCM encrypted PKCS#8 PEM private key. Never returned by the API. */
  @Column({ type: 'text' })
  privateKeyEncrypted: string;

  @Column({ type: 'varchar', length: 16, default: 'active' })
  status: WebhookSigningKeyStatus;

  /** Set when the key is rotated out; the key is unpublished after this. */
  @Column({ type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
