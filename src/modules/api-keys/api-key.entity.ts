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

@Entity('api_keys')
export class ApiKey {
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

  @Column({ type: 'enum', enum: ApiKeyScope, default: ApiKeyScope.READ })
  @ApiProperty({ enum: ApiKeyScope, example: ApiKeyScope.READ })
  scope: ApiKeyScope;

  @Column({ type: 'enum', enum: ApiKeyEnvironment, default: ApiKeyEnvironment.LIVE })
  @ApiProperty({ enum: ApiKeyEnvironment, example: ApiKeyEnvironment.LIVE })
  environment: ApiKeyEnvironment;

  @Column({ nullable: true, type: 'timestamp' })
  @ApiPropertyOptional({ example: '2027-01-01T00:00:00.000Z' })
  expiresAt: Date | null;

  @Column({ nullable: true, type: 'timestamp' })
  @ApiPropertyOptional({ example: '2026-06-28T10:00:00.000Z' })
  lastUsedAt: Date | null;

  @Column({ default: true })
  @ApiProperty({ example: true })
  isActive: boolean;

  @CreateDateColumn()
  @ApiProperty()
  createdAt: Date;

  @UpdateDateColumn()
  @ApiProperty()
  updatedAt: Date;
}
