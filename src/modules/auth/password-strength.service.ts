import { Injectable, BadRequestException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { firstValueFrom } from 'rxjs';

export interface PasswordStrengthResult {
  score: number;
  feedback: string[];
}

@Injectable()
export class PasswordStrengthService {
  private readonly minLength: number;
  private readonly hibpEnabled: boolean;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.minLength = this.configService.get<number>('PASSWORD_MIN_LENGTH', 10);
    this.hibpEnabled = this.configService.get<string>('HIBP_CHECK_ENABLED', 'true') !== 'false';
  }

  /**
   * Validates password policy and checks HIBP breach database.
   * Throws BadRequestException if the password fails.
   * Returns a strength score (0-4) on success.
   */
  async validateAndScore(password: string): Promise<PasswordStrengthResult> {
    const feedback: string[] = [];

    if (password.length < this.minLength) {
      feedback.push(`Password must be at least ${this.minLength} characters long`);
    }
    if (!/[a-z]/.test(password)) {
      feedback.push('Password must contain at least one lowercase letter');
    }
    if (!/[A-Z]/.test(password)) {
      feedback.push('Password must contain at least one uppercase letter');
    }
    if (!/\d/.test(password)) {
      feedback.push('Password must contain at least one number');
    }
    if (!/[^a-zA-Z0-9]/.test(password)) {
      feedback.push('Password must contain at least one special character');
    }

    if (feedback.length > 0) {
      throw new BadRequestException(feedback);
    }

    if (this.hibpEnabled) {
      const breachCount = await this.checkHibp(password);
      if (breachCount > 0) {
        throw new BadRequestException(
          `This password has appeared in ${breachCount.toLocaleString()} data breach(es). Please choose a different password.`,
        );
      }
    }

    return { score: this.computeScore(password), feedback: [] };
  }

  private computeScore(password: string): number {
    let score = 0;
    if (password.length >= 12) score++;
    if (password.length >= 16) score++;
    if (/[^a-zA-Z0-9]/.test(password)) score++;
    if (/\d.*\d/.test(password)) score++;
    return Math.min(score, 4);
  }

  private async checkHibp(password: string): Promise<number> {
    const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);

    try {
      const response = await firstValueFrom(
        this.httpService.get<string>(
          `https://api.pwnedpasswords.com/range/${prefix}`,
          { responseType: 'text', headers: { 'Add-Padding': 'true' } },
        ),
      );

      const lines: string[] = (response.data as string).split('\n');
      for (const line of lines) {
        const [hashSuffix, count] = line.trim().split(':');
        if (hashSuffix === suffix) {
          return parseInt(count, 10);
        }
      }
      return 0;
    } catch {
      // If HIBP is unreachable, fail open (don't block registration)
      return 0;
    }
  }
}
