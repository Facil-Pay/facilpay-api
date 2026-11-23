import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum ApiKeyScope {
  READ = 'read',
  WRITE = 'write',
  ADMIN = 'admin',
}

export enum ApiKeyEnvironment {
  LIVE = 'live',
  TEST = 'test',
}

/**
 * Granular API Key Scopes (resource:action format)
 * Examples: 'payments:read', 'payment-links:write', 'webhooks:admin'
 * Backward compatible with legacy scope column
 */
export type GranularScope = string;

@Entity('api_keys')
export class ApiKey {
  @Column({ default: false })
  @ApiProperty({ default: false, description: 'Require HMAC signatures and timestamps on API requests' })
  requireSignedRequests: boolean;

  @Column({ type: 'text', nullable: true, select: false })
  signingSecretEncrypted: string | null;

  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  id: string;

  @Column()
  @ApiProperty({ example: 'My integration key' })
  name: string;

  @Index({ unique: true })
  @Column()
  keyHash: string;

  @Column({ length: 12 })
  @ApiProperty({ example: 'fp_live_xxxx', description: 'First 12 chars of key for display' })
  keyPrefix: string;

  @Column()
  userId: string;

  @Column({ type: 'enum', enum: ApiKeyScope, default: ApiKeyScope.READ, nullable: true })
  @ApiPropertyOptional({ enum: ApiKeyScope, example: ApiKeyScope.READ, description: 'Deprecated: use scopes instead' })
  scope: ApiKeyScope | null;

  @Column({ type: 'text', array: true, default: [] })
  @ApiProperty({
    example: ['payments:read', 'payment-links:write'],
    description: 'Granular scopes in resource:action format. Examples: payments:read, payment-links:write, settlements:admin',
  })
  scopes: GranularScope[] = [];

  @Column({ type: 'enum', enum: ApiKeyEnvironment, default: ApiKeyEnvironment.LIVE })
  @ApiProperty({ enum: ApiKeyEnvironment, example: ApiKeyEnvironment.LIVE })
  environment: ApiKeyEnvironment;

  @Column({ nullable: true, type: 'timestamp' })
  @ApiPropertyOptional({ example: '2027-01-01T00:00:00.000Z' })
  expiresAt: Date | null;

  @Column({ type: 'int', nullable: true })
  @ApiPropertyOptional({ enum: [14, 7, 1] })
  lastExpiryWarningDays: number | null;

  @Column({ nullable: true, type: 'timestamp' })
  @ApiPropertyOptional({ example: '2026-06-28T10:00:00.000Z' })
  lastUsedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  inactivityWarningAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  inactivityRevokeAt: Date | null;

  @Column({ default: true })
  @ApiProperty({ example: true })
  isActive: boolean;

  @Column({ type: 'int', nullable: true })
  @ApiPropertyOptional({
    description:
      'Custom requests-per-window limit for this key. When set, overrides the global default rate limit.',
    example: 500,
  })
  rateLimitLimit: number | null;

  @Column({ type: 'int', nullable: true })
  @ApiPropertyOptional({
    description:
      'Window size in milliseconds for rateLimitLimit. Defaults to the global window when not set.',
    example: 60000,
  })
  rateLimitTtl: number | null;

  @Column({ type: 'text', array: true, default: '{}' })
  @ApiPropertyOptional({
    description:
      'Optional list of allowed IP addresses or CIDR ranges. An empty array means no restriction (all IPs allowed).',
    example: ['192.168.1.0/24', '10.0.0.1'],
  })
  allowedIps: string[];

  @CreateDateColumn()
  @ApiProperty()
  createdAt: Date;

  @UpdateDateColumn()
  @ApiProperty()
  updatedAt: Date;
}
