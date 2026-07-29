import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApiKey } from './api-key.entity';

@Entity('api_key_usage')
@Index(['apiKeyId'])
@Index(['createdAt'])
export class ApiKeyUsage {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  id: string;

  @Column()
  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  apiKeyId: string;

  @ManyToOne(() => ApiKey, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'apiKeyId' })
  apiKey?: ApiKey;

  @Column({ length: 500 })
  @ApiProperty({ example: '/v1/payments' })
  endpoint: string;

  @Column({ length: 10 })
  @ApiProperty({ example: 'POST' })
  method: string;

  @Column({ length: 45, nullable: true })
  @ApiPropertyOptional({ example: '192.168.1.1' })
  sourceIp: string | null;

  @Column({ type: 'text', nullable: true })
  @ApiPropertyOptional({
    example: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)...',
  })
  userAgent: string | null;

  @Column({ type: 'int', nullable: true })
  @ApiPropertyOptional({ example: 200 })
  statusCode: number | null;

  @CreateDateColumn()
  @ApiProperty()
  createdAt: Date;
}
