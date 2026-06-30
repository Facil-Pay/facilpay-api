import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserRole } from '../../common/constants/roles';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column()
  password: string;

  @Column({ nullable: true })
  name: string | null = null;

  @Column('text', { array: true, default: [UserRole.USER] })
  roles: UserRole[] = [UserRole.USER];

  @Column({ default: false })
  isEmailVerified: boolean = false;

  @Column({ default: true })
  isActive: boolean = true;

  @Column({ nullable: true })
  twoFactorSecret: string | null = null;
  
  @Column({ default: false })
  twoFactorEnabled: boolean = false;
  
  @Column('text', { array: true, nullable: true })
  backupCodes: string[] | null = null;

  @Column({ type: 'timestamp', nullable: true })
  deletedAt: Date | null = null;

  @Column({ default: 0 })
  failedLoginAttempts: number = 0;

  @Column({ nullable: true })
  lockedUntil: Date | null = null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  constructor(partial?: Partial<User>) {
    Object.assign(this, partial);
    if (!this.roles) {
      this.roles = [UserRole.USER];
    }
    if (this.isEmailVerified === undefined) {
      this.isEmailVerified = false;
    }
    if (this.isActive === undefined) {
      this.isActive = true;
    }
    if (this.twoFactorSecret === undefined) {
      this.twoFactorSecret = null;
    }
    if (this.twoFactorEnabled === undefined) {
      this.twoFactorEnabled = false;
    }
    if (this.backupCodes === undefined) {
      this.backupCodes = null;
    }
    if (this.deletedAt === undefined) {
      this.deletedAt = null;
    }
    if (this.failedLoginAttempts === undefined) {
      this.failedLoginAttempts = 0;
    }
    if (this.lockedUntil === undefined) {
      this.lockedUntil = null;
    }
  }
}
