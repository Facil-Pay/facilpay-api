import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { Settlement } from '../../settlements/entities/settlement.entity';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character];
  });
}

@Injectable()
export class MailService {
  private transporter: nodemailer.Transporter;

  constructor(private configService: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host: this.configService.get<string>('SMTP_HOST', 'smtp.ethereal.email'),
      port: this.configService.get<number>('SMTP_PORT', 587),
      secure: this.configService.get<string>('SMTP_SECURE', 'false') === 'true',
      auth: {
        user: this.configService.get<string>('SMTP_USER', ''),
        pass: this.configService.get<string>('SMTP_PASS', ''),
      },
    });
  }

  async sendTeamTwoFactorRequired(to: string): Promise<void> {
    await this.transporter.sendMail({
      from: this.configService.get<string>('SMTP_FROM', 'noreply@facilpay.com'), to,
      subject: 'Your team now requires two-factor authentication',
      text: 'Your merchant team requires two-factor authentication. Set up an authenticator or register a passkey to regain access.',
    });
  }

  async sendApiKeyInactivityWarning(to: string, prefix: string, revokeAt: Date): Promise<void> {
    await this.transporter.sendMail({
      from: this.configService.get<string>('SMTP_FROM', 'noreply@facilpay.com'), to,
      subject: 'An inactive FacilPay API key will be revoked',
      text: 'Your inactive API key ' + prefix + ' will be revoked on ' + revokeAt.toISOString() + '. Use the key before that date to keep it active, or revoke it now.',
    });
  }

  async sendMagicLinkEmail(to: string, token: string): Promise<void> {
    const appUrl = this.configService.get<string>('APP_URL', 'http://localhost:3000');
    const url = appUrl + '/auth/magic-link?token=' + encodeURIComponent(token);
    await this.transporter.sendMail({
      from: this.configService.get<string>('SMTP_FROM', '"FacilPay" <noreply@facilpay.com>'),
      to, subject: 'Sign in to FacilPay',
      text: 'Sign in: ' + url + '. This link can be used once and expires in 15 minutes.',
      html: '<p><a href="' + escapeHtml(url) + '">Sign in to FacilPay</a></p><p>This link can be used once and expires in 15 minutes. Ignore this email if you did not request it.</p>',
    });
  }

  async sendVerificationEmail(to: string, token: string): Promise<void> {
    const appUrl = this.configService.get<string>(
      'APP_URL',
      'http://localhost:3000',
    );
    const verifyUrl = `${appUrl}/auth/verify-email?token=${token}`;

    await this.transporter.sendMail({
      from: this.configService.get<string>(
        'SMTP_FROM',
        '"FacilPay" <noreply@facilpay.com>',
      ),
      to,
      subject: 'Verify your FacilPay email address',
      text: `Click the link to verify your email: ${verifyUrl}`,
      html: `<p>Click the link to verify your email address:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p><p>This link expires in 24 hours.</p>`,
    });
  }

  async sendMerchantStatusEmail(
    to: string,
    status: 'SUSPENDED' | 'ACTIVE',
    reason?: string | null,
  ): Promise<void> {
    const suspended = status === 'SUSPENDED';
    const subject = suspended
      ? 'Your FacilPay merchant account has been suspended'
      : 'Your FacilPay merchant account has been reinstated';
    const statusMessage = suspended
      ? `Your merchant account has been suspended.${reason ? ` Reason: ${reason}` : ''} New transactions and payouts are disabled while the suspension is active.`
      : 'Your merchant account has been reinstated. You can resume using FacilPay services.';
    const htmlMessage = statusMessage.replace(/[&<>"']/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[character] as string);
    await this.transporter.sendMail({
      from: this.configService.get<string>(
        'SMTP_FROM',
        '"FacilPay" <noreply@facilpay.com>',
      ),
      to,
      subject,
      text: statusMessage,
      html: `<p>${htmlMessage}</p>`,
    });
  }

  async sendLowStellarBalanceAlert(
    to: string,
    assetCode: string,
    balance: string,
    threshold: number,
    accountAddress: string,
  ): Promise<void> {
    const subject = `FacilPay Stellar balance low: ${assetCode}`;
    const text = `The platform Stellar distribution account ${accountAddress} has ${balance} ${assetCode}, below the configured threshold of ${threshold} ${assetCode}.`;
    await this.transporter.sendMail({
      from: this.configService.get<string>(
        'SMTP_FROM',
        '"FacilPay" <noreply@facilpay.com>',
      ),
      to,
      subject,
      text,
      html: `<p>${text}</p>`,
    });
  }

  async sendSettlementNotification(
    to: string,
    settlement: Settlement,
    totalAmount: number,
  ): Promise<void> {
    await this.transporter.sendMail({
      from: this.configService.get<string>(
        'SMTP_FROM',
        '"FacilPay" <noreply@facilpay.com>',
      ),
      to,
      subject: `FacilPay: Your ${settlement.schedule} settlement has been processed`,
      text:
        `Your ${settlement.schedule} settlement has been processed.\n\n` +
        `Total: ${totalAmount} ${settlement.currency}\n` +
        `Payments included: ${settlement.paymentIds.length}\n` +
        `Processed at: ${settlement.processedAt.toISOString()}`,
      html:
        `<p>Your <strong>${settlement.schedule}</strong> settlement has been processed.</p>` +
        `<ul>` +
        `<li>Total: <strong>${totalAmount} ${settlement.currency}</strong></li>` +
        `<li>Payments included: ${settlement.paymentIds.length}</li>` +
        `<li>Processed at: ${settlement.processedAt.toISOString()}</li>` +
        `</ul>`,
    });
  }

  async sendPayoutDestinationVerificationEmail(
    to: string,
    destinationId: string,
    label: string,
    token: string,
  ): Promise<void> {
    const appUrl = this.configService.get<string>(
      'APP_URL',
      'http://localhost:3000',
    );
    const verifyUrl = `${appUrl}/v1/settlements/destinations/${destinationId}/verify?token=${encodeURIComponent(token)}`;

    await this.transporter.sendMail({
      from: this.configService.get<string>(
        'SMTP_FROM',
        '"FacilPay" <noreply@facilpay.com>',
      ),
      to,
      subject: 'Confirm your FacilPay payout destination',
      text: `Confirm the payout destination "${label}" by opening: ${verifyUrl}. This link expires in 24 hours.`,
      html: `<p>Confirm the payout destination <strong>${label}</strong> by clicking the link below.</p><p><a href="${verifyUrl}">${verifyUrl}</a></p><p>This link expires in 24 hours.</p>`,
    });
  }

  async sendPasswordResetEmail(to: string, token: string): Promise<void> {
    const appUrl = this.configService.get<string>(
      'APP_URL',
      'http://localhost:3000',
    );
    const resetUrl = `${appUrl}/auth/reset-password?token=${token}`;

    await this.transporter.sendMail({
      from: this.configService.get<string>(
        'SMTP_FROM',
        '"FacilPay" <noreply@facilpay.com>',
      ),
      to,
      subject: 'Reset your FacilPay password',
      text: `Click the link to reset your password: ${resetUrl}`,
      html: `<p>You requested to reset your password.</p><p>Click the link below to reset your password:</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>This link expires in 1 hour.</p><p>If you did not request this, please ignore this email.</p>`,
    });
  }

  async sendPasswordChangedEmail(to: string): Promise<void> {
    await this.transporter.sendMail({
      from: this.configService.get<string>(
        'SMTP_FROM',
        '"FacilPay" <noreply@facilpay.com>',
      ),
      to,
      subject: 'Your FacilPay password was changed',
      text: 'Your password was changed successfully. If you did not make this change, contact support immediately.',
      html: '<p>Your password was changed successfully.</p><p>If you did not make this change, contact support immediately.</p>',
    });
  }

  async sendNewLoginAlertEmail(
    to: string,
    details: {
      time: Date;
      ipAddress: string | null;
      countryCode: string | null;
      device: string;
      userAgent: string | null;
      reportUrl: string;
    },
  ): Promise<void> {
    const appUrl = this.configService.get<string>(
      'APP_URL',
      'http://localhost:3000',
    );
    const date = details.time.toISOString();
    const location = details.countryCode ?? 'Unknown location';
    const ipAddress = details.ipAddress ?? 'Unknown IP';
    const device = details.device.slice(0, 512);
    const userAgent = (details.userAgent ?? 'Unknown browser').slice(0, 512);
    const reportUrl = escapeHtml(details.reportUrl);

    await this.transporter.sendMail({
      from: this.configService.get<string>(
        'SMTP_FROM',
        '"FacilPay" <noreply@facilpay.com>',
      ),
      to,
      subject: 'New sign-in to your FacilPay account',
      text:
        `A new sign-in was detected at ${date}.\n` +
        `IP: ${ipAddress}\nLocation: ${location}\nDevice: ${device}\n` +
        `Browser: ${userAgent}\n\nIf this was not you, report it here: ${details.reportUrl}`,
      html:
        `<p>A new sign-in was detected on your FacilPay account.</p>` +
        `<ul><li>Time: ${escapeHtml(date)}</li>` +
        `<li>IP: ${escapeHtml(ipAddress)}</li>` +
        `<li>Location: ${escapeHtml(location)}</li>` +
        `<li>Device: ${escapeHtml(device)}</li>` +
        `<li>Browser: ${escapeHtml(userAgent)}</li></ul>` +
        `<p><a href="${reportUrl}">This wasn't me</a></p>` +
        `<p>If you don't recognize this sign-in, report it to revoke sessions and require a password reset.</p>` +
        `<p><a href="${escapeHtml(appUrl)}">FacilPay</a></p>`,
    });
  }

  async sendTwoFactorDisabledEmail(to: string): Promise<void> {
    await this.transporter.sendMail({
      from: this.configService.get<string>(
        'SMTP_FROM',
        '"FacilPay" <noreply@facilpay.com>',
      ),
      to,
      subject:
        'Two-factor authentication was disabled on your FacilPay account',
      text: 'Two-factor authentication has been disabled for your account. If you did not do this, please secure your account immediately.',
      html: '<p>Two-factor authentication has been disabled for your account.</p><p>If you did not do this, please secure your account immediately.</p>',
    });
  }

  async sendAccountLockedEmail(
    to: string,
    lockDurationMinutes: number,
  ): Promise<void> {
    await this.transporter.sendMail({
      from: this.configService.get<string>(
        'SMTP_FROM',
        '"FacilPay" <noreply@facilpay.com>',
      ),
      to,
      subject: 'Your FacilPay account has been locked',
      text: `Your account has been temporarily locked after repeated failed login attempts. It will unlock in ${lockDurationMinutes} minutes. If this was not you, secure your account immediately.`,
      html: `<p>Your account has been temporarily locked after repeated failed login attempts.</p><p>It will unlock in <strong>${lockDurationMinutes}</strong> minutes.</p><p>If this was not you, secure your account immediately.</p>`,
    });
  }

  async sendSecurityAlertEmail(to: string, event: string): Promise<void> {
    await this.transporter.sendMail({
      from: this.configService.get<string>(
        'SMTP_FROM',
        '"FacilPay" <noreply@facilpay.com>',
      ),
      to,
      subject: `FacilPay security alert: ${event}`,
      text: `A security-sensitive action was performed on your account: ${event}. If this was not you, secure your account immediately by contacting support.`,
      html: `<p>A security-sensitive action was performed on your account: <strong>${event}</strong>.</p><p>If this was not you, please contact support immediately to secure your account.</p>`,
    });
  }

  async sendEmailChangeConfirmation(
    to: string,
    token: string,
    newEmail: string,
  ): Promise<void> {
    const appUrl = this.configService.get<string>('APP_URL', 'http://localhost:3000');
    const confirmUrl = `${appUrl}/v1/users/me/email/confirm?token=${encodeURIComponent(token)}`;

    await this.transporter.sendMail({
      from: this.configService.get<string>(
        'SMTP_FROM',
        '"FacilPay" <noreply@facilpay.com>',
      ),
      to,
      subject: 'Confirm your new FacilPay email address',
      text: `Please confirm your new email address (${newEmail}) by opening this link: ${confirmUrl}. This link expires in 24 hours. If you did not request this, ignore this email.`,
      html: `<p>Please confirm your new email address <strong>${newEmail}</strong> by clicking the link below:</p><p><a href="${confirmUrl}">${confirmUrl}</a></p><p>This link expires in 24 hours.</p><p>If you did not request this change, you can safely ignore this email.</p>`,
    });
  }

  async sendEmailChangeNotice(
    to: string,
    newEmail: string,
    revertToken: string,
  ): Promise<void> {
    const appUrl = this.configService.get<string>('APP_URL', 'http://localhost:3000');
    const revertUrl = `${appUrl}/v1/users/me/email/revert?token=${encodeURIComponent(revertToken)}`;

    await this.transporter.sendMail({
      from: this.configService.get<string>(
        'SMTP_FROM',
        '"FacilPay" <noreply@facilpay.com>',
      ),
      to,
      subject: 'Your FacilPay email address is being changed',
      text: `A request was made to change your FacilPay email address to ${newEmail}. If this was you, no action is needed. If this was NOT you, click this link to revert the change: ${revertUrl}. This link expires in 24 hours.`,
      html: `<p>A request was made to change your FacilPay email address to <strong>${newEmail}</strong>.</p><p>If this was you, no action is needed — the change will complete once you confirm from the new address.</p><p>If this was <strong>not</strong> you, <a href="${revertUrl}">click here to cancel and revert the change</a>. This link expires in 24 hours.</p>`,
    });
  }

  async sendDataExportReadyEmail(
    to: string,
    downloadToken: string,
  ): Promise<void> {
    const appUrl = this.configService.get<string>('APP_URL', 'http://localhost:3000');
    const downloadUrl = `${appUrl}/v1/users/me/data-export/download?token=${encodeURIComponent(downloadToken)}`;

    await this.transporter.sendMail({
      from: this.configService.get<string>(
        'SMTP_FROM',
        '"FacilPay" <noreply@facilpay.com>',
      ),
      to,
      subject: 'Your FacilPay personal data export is ready',
      text: `Your personal data export is ready. Download it here: ${downloadUrl}. This link expires in 48 hours.`,
      html: `<p>Your personal data export is ready.</p><p><a href="${downloadUrl}">Download your data</a></p><p>This link expires in 48 hours.</p>`,
    });
  }
}
