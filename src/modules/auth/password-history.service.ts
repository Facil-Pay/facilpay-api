import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { compare } from 'bcrypt';
import { PasswordHistory } from './entities/password-history.entity';

export const PASSWORD_HISTORY_LIMIT = 5; // Keep last 5 passwords

@Injectable()
export class PasswordHistoryService {
  constructor(
    @InjectRepository(PasswordHistory)
    private readonly passwordHistoryRepository: Repository<PasswordHistory>,
  ) {}

  /**
   * Check if the new password matches any of the user's recent passwords.
   * Takes the plain-text password, since bcrypt hashes are salted and can
   * only be compared against a plain value.
   * Throws BadRequestException if password reuse is detected.
   */
  async validatePasswordNotReused(
    userId: string,
    newPassword: string,
  ): Promise<void> {
    // Get the user's password history (last N passwords)
    const history = await this.passwordHistoryRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: PASSWORD_HISTORY_LIMIT,
    });

    if (history.length === 0) {
      // No history yet, allow the password
      return;
    }

    // Check if new password matches any historical password
    for (const entry of history) {
      const isMatch = await compare(newPassword, entry.passwordHash);
      if (isMatch) {
        throw new BadRequestException(
          `You cannot reuse a password from your recent history. Please choose a different password.`,
        );
      }
    }
  }

  /**
   * Record the current password in history after a successful password change.
   */
  async recordPasswordChange(userId: string, passwordHash: string): Promise<void> {
    // Add the new password to history
    const entry = this.passwordHistoryRepository.create({
      userId,
      passwordHash,
    });
    await this.passwordHistoryRepository.save(entry);

    // Clean up old entries beyond the limit
    const allHistory = await this.passwordHistoryRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });

    if (allHistory.length > PASSWORD_HISTORY_LIMIT) {
      const toDelete = allHistory.slice(PASSWORD_HISTORY_LIMIT);
      await this.passwordHistoryRepository.remove(toDelete);
    }
  }
}
