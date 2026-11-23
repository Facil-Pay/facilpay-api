import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

@Entity('oauth_clients')
export class OAuthClient {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') developerId: string;
  @Column({ length: 255 }) name: string;
  @Column({ select: false }) secretHash: string;
  @Column('text', { array: true }) redirectUris: string[];
  @Column('text', { array: true }) scopes: string[];
  @Column({ default: true }) isActive: boolean;
  @CreateDateColumn() createdAt: Date;
}

@Entity('oauth_grants')
@Index('IDX_oauth_grants_merchant', ['merchantId'])
export class OAuthGrant {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') clientId: string;
  @ManyToOne(() => OAuthClient, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'clientId' }) client: OAuthClient;
  @Column('uuid') merchantId: string;
  @Column('text', { array: true }) scopes: string[];
  @Column({ type: 'timestamptz', nullable: true }) revokedAt: Date | null;
  @CreateDateColumn() createdAt: Date;
}

@Entity('oauth_credentials')
@Index('IDX_oauth_credentials_grant', ['grantId'])
export class OAuthCredential {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Index({ unique: true })
  @Column({ length: 64 }) tokenHash: string;
  @Column({ type: 'varchar', length: 16 }) kind: 'code' | 'access' | 'refresh';
  @Column('uuid') grantId: string;
  @ManyToOne(() => OAuthGrant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'grantId' }) grant: OAuthGrant;
  @Column({ type: 'timestamptz' }) expiresAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) consumedAt: Date | null;
  @Column({ type: 'text', nullable: true }) redirectUri: string | null;
  @Column({ type: 'varchar', length: 43, nullable: true }) codeChallenge: string | null;
}
