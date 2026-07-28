import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('sessions')
export class Session {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column()
  userId: string;

  @Column({ nullable: true })
  deviceInfo: string | null;

  @Column({ nullable: true })
  ipAddress: string | null;

  @Column({ nullable: true, length: 512 })
  userAgent: string | null;

  @Column({ type: 'timestamp with time zone' })
  lastActiveAt: Date;

  @Column({ type: 'timestamp with time zone' })
  expiresAt: Date;

  @Column({ default: false })
  revoked: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
