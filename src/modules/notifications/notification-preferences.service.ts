import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  NotificationPreference,
  NotificationCategory,
  ALL_NOTIFICATION_CATEGORIES,
} from './notification-preference.entity';

export type PreferenceMap = Record<NotificationCategory, boolean>;

@Injectable()
export class NotificationPreferencesService {
  constructor(
    @InjectRepository(NotificationPreference)
    private readonly repo: Repository<NotificationPreference>,
  ) {}

  async getForUser(userId: string): Promise<PreferenceMap> {
    const rows = await this.repo.find({ where: { userId } });
    const map = this.defaultMap();
    for (const row of rows) {
      map[row.category] = row.email;
    }
    map[NotificationCategory.SECURITY] = true;
    return map;
  }

  async updateForUser(
    userId: string,
    updates: Partial<Record<NotificationCategory, boolean>>,
  ): Promise<PreferenceMap> {
    for (const [category, enabled] of Object.entries(updates) as [
      NotificationCategory,
      boolean,
    ][]) {
      if (category === NotificationCategory.SECURITY) {
        continue;
      }
      await this.repo.upsert(
        { userId, category, email: enabled },
        { conflictPaths: ['userId', 'category'] },
      );
    }
    return this.getForUser(userId);
  }

  async isEmailEnabled(
    userId: string,
    category: NotificationCategory,
  ): Promise<boolean> {
    if (category === NotificationCategory.SECURITY) {
      return true;
    }
    if (
      category !== NotificationCategory.DIGEST &&
      (await this.isDigestEnabled(userId))
    ) {
      return false;
    }
    const pref = await this.repo.findOne({ where: { userId, category } });
    return pref ? pref.email : true;
  }

  async isDigestEnabled(userId: string): Promise<boolean> {
    const pref = await this.repo.findOne({
      where: { userId, category: NotificationCategory.DIGEST },
    });
    return pref ? pref.email : false;
  }

  async listDigestSubscribers(): Promise<string[]> {
    const rows = await this.repo.find({
      where: { category: NotificationCategory.DIGEST, email: true },
    });
    return rows.map((row) => row.userId);
  }

  private defaultMap(): PreferenceMap {
    return ALL_NOTIFICATION_CATEGORIES.reduce((acc, cat) => {
      acc[cat] = cat !== NotificationCategory.DIGEST;
      return acc;
    }, {} as PreferenceMap);
  }
}
