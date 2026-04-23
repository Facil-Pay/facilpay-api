import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('refresh_tokens')
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  token: string;

  @Column()
  userId: string;

  @Column({ type: 'timestamp with time zone' })
  expiresAt: Date;

  @Column({ default: false })
  revoked: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
