import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Unique,
  Index,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';

export enum NotificationCategory {
  PAYMENTS = 'payments',
  REFUNDS = 'refunds',
  DISPUTES = 'disputes',
  SETTLEMENTS = 'settlements',
  SECURITY = 'security',
  REPORTS = 'reports',
  DIGEST = 'digest',
}

export const ALL_NOTIFICATION_CATEGORIES = Object.values(NotificationCategory);

@Entity('notification_preferences')
@Unique('UQ_notification_preferences_userId_category', ['userId', 'category'])
@Index('IDX_notification_preferences_userId', ['userId'])
export class NotificationPreference {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty()
  id: string;

  @Column('uuid')
  @ApiProperty()
  userId: string;

  @Column({ type: 'varchar', length: 50 })
  @ApiProperty({ enum: NotificationCategory })
  category: NotificationCategory;

  @Column({ default: true })
  @ApiProperty({ example: true })
  email: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
