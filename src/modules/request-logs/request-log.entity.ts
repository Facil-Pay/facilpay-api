import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';

@Entity('request_logs')
@Index('IDX_request_logs_merchant_created', ['merchantId', 'createdAt'])
export class RequestLog {
  @PrimaryGeneratedColumn('uuid') @ApiProperty() id: string;
  @Column('uuid') merchantId: string;
  @Column('uuid') @ApiProperty() apiKeyId: string;
  @Column({ length: 16 }) @ApiProperty() method: string;
  @Column({ length: 2048 }) @ApiProperty() path: string;
  @Column('int') @ApiProperty() status: number;
  @Column('int') @ApiProperty() latencyMs: number;
  @Column({ type: 'varchar', length: 255, nullable: true }) @ApiProperty({ nullable: true }) idempotencyKey: string | null;
  @Column('jsonb', { nullable: true }) @ApiProperty({ type: Object, nullable: true }) requestBody: unknown;
  @Column('jsonb', { nullable: true }) @ApiProperty({ type: Object, nullable: true }) responseBody: unknown;
  @CreateDateColumn({ type: 'timestamptz' }) @ApiProperty() createdAt: Date;
}
