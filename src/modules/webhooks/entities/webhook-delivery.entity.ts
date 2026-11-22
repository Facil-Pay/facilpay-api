import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { WebhookEndpoint } from './webhook-endpoint.entity';

export enum WebhookDeliveryStatus {
  PENDING = 'pending',
  SUCCESS = 'success',
  FAILED = 'failed',
  DEAD_LETTER = 'dead-letter',
}

@Entity('webhook_deliveries')
export class WebhookDelivery {
  @Column({ type: 'int', nullable: true })
  latencyMs: number | null;

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  endpointId: string;

  @Index('IDX_webhook_deliveries_replayId')
  @Column({ type: 'uuid', nullable: true })
  replayId: string | null = null;

  @ManyToOne(() => WebhookEndpoint, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'endpointId' })
  endpoint: WebhookEndpoint;

  @Column('jsonb')
  payload: Record<string, any>;

  @Column({
    type: 'enum',
    enum: WebhookDeliveryStatus,
    default: WebhookDeliveryStatus.PENDING,
  })
  status: WebhookDeliveryStatus;

  @Column({ default: 0 })
  attempts: number;

  @Column({ type: 'timestamp', nullable: true })
  lastAttemptAt: Date | null;

  @Column({ type: 'int', nullable: true })
  lastResponseCode: number | null;

  @Column({ type: 'text', nullable: true })
  lastError: string | null;

  /** Truncated body of the latest response from the endpoint. */
  @Column({ type: 'text', nullable: true })
  lastResponseBody: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
