import { Injectable, Logger } from '@nestjs/common';
import { SmsProvider } from '../interfaces/sms-provider.interface';

@Injectable()
export class MockSmsProvider implements SmsProvider {
  private readonly logger = new Logger(MockSmsProvider.name);

  async sendSms(to: string, body: string): Promise<string> {
    this.logger.log(`[MOCK SMS] To: ${to}, Body: ${body}`);
    return `mock-${Date.now()}`;
  }

  async sendVerificationCode(to: string, code: string): Promise<string> {
    this.logger.log(`[MOCK SMS] Verification code ${code} sent to ${to}`);
    return `mock-verification-${Date.now()}`;
  }
}
