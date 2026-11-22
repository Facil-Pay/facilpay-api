import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('magic_link_tokens')
export class MagicLinkToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @Column('uuid')
  userId: string;
  @Index({ unique: true })
  @Column({ length: 64 })
  tokenHash: string;
  @Column({ type: 'timestamptz' })
  expiresAt: Date;
  @Column({ default: false })
  used: boolean;
  @CreateDateColumn()
  createdAt: Date;
}
