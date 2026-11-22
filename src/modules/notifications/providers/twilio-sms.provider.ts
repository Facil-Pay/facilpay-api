import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SmsProvider } from '../interfaces/sms-provider.interface';
import * as twilio from 'twilio';

@Injectable()
export class TwilioSmsProvider implements SmsProvider {
  private readonly logger = new Logger(TwilioSmsProvider.name);
  private readonly client: twilio.Twilio;
  private readonly fromNumber: string;

  constructor(private readonly configService: ConfigService) {
    const accountSid = this.configService.get<string>('TWILIO_ACCOUNT_SID');
    const authToken = this.configService.get<string>('TWILIO_AUTH_TOKEN');
    this.fromNumber = this.configService.get<string>('TWILIO_PHONE_NUMBER', '');

    if (accountSid && authToken) {
      this.client = twilio.default(accountSid, authToken);
    } else {
      this.logger.warn('Twilio credentials not configured. SMS sending will be disabled.');
    }
  }

  async sendSms(to: string, body: string): Promise<string> {
    if (!this.client) {
      this.logger.warn(`SMS not sent to ${to}: Twilio not configured`);
      return 'mock-message-id';
    }

    try {
      const message = await this.client.messages.create({
        body,
        from: this.fromNumber,
        to,
      });

      this.logger.log(`SMS sent to ${to}, message ID: ${message.sid}`);
      return message.sid;
    } catch (error) {
      this.logger.error(`Failed to send SMS to ${to}:`, error);
      throw error;
    }
  }

  async sendVerificationCode(to: string, code: string): Promise<string> {
    const body = `Your verification code is: ${code}. This code will expire in 10 minutes.`;
    return this.sendSms(to, body);
  }
}
