import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomUUID,
  randomBytes,
} from 'crypto';
import * as bcrypt from 'bcrypt';
import { User } from '../users/user.entity';
import { RegisterDto } from '../users/dto/register.dto';
import { LoginDto } from '../users/dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { TwoFactorCodeDto } from './dto/two-factor-code.dto';
import { UsersService } from '../users/users.service';
import { AppLogger } from '../logger/logger.service';
import { Logger } from 'pino';
import { RefreshToken } from './entities/refresh-token.entity';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { MailService } from './mail/mail.service';

@Injectable()
export class AuthService {
  private readonly logger: Logger;
  private readonly maxFailedAttempts: number;
  private readonly lockDurationMinutes: number;
  private readonly twoFactorIssuer = 'FacilPay';

  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private mailService: MailService,
    private configService: ConfigService,
    private dataSource: DataSource,
    @InjectRepository(RefreshToken)
    private refreshTokenRepository: Repository<RefreshToken>,
    @InjectRepository(PasswordResetToken)
    private passwordResetTokenRepository: Repository<PasswordResetToken>,
    appLogger: AppLogger,
  ) {
    this.logger = appLogger.child({ module: AuthService.name });
    this.maxFailedAttempts = this.configService.get<number>('LOGIN_MAX_ATTEMPTS', 5);
    this.lockDurationMinutes = this.configService.get<number>('LOGIN_LOCK_DURATION_MINUTES', 15);
  }

  async register(
    registerDto: RegisterDto,
  ): Promise<{ message: string; user: Omit<User, 'password'> }> {
    const existingUser = await this.usersService.findByEmail(registerDto.email);
    if (existingUser) {
      throw new UnauthorizedException('User already exists');
    }

    const user = await this.usersService.create(registerDto);
    this.logger.info({ userId: user.id, email: user.email }, 'User registered');

    const verificationToken = this.jwtService.sign(
      { sub: user.id, email: user.email, purpose: 'email-verification' },
      { expiresIn: '24h' },
    );

    try {
      await this.mailService.sendVerificationEmail(
        user.email,
        verificationToken,
      );
    } catch (err) {
      this.logger.warn(
        { userId: user.id, error: err.message },
        'Failed to send verification email',
      );
    }

    return {
      message:
        'User registered successfully. Please check your email to verify your account.',
      user,
    };
  }

  async login(loginDto: LoginDto): Promise<{
    access_token?: string;
    refresh_token?: string;
    user?: Omit<User, 'password' | 'twoFactorSecret'>;
    '2fa_required'?: boolean;
    message?: string;
  }> {
    const user = await this.usersService.findByEmail(loginDto.email);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check if account is locked
    if (this.usersService.isAccountLocked(user)) {
      const secondsUntilUnlock = this.usersService.getSecondsUntilUnlock(user);
      const error: any = new HttpException(
        {
          statusCode: 423,
          message: `Account is locked. Please try again in ${secondsUntilUnlock} seconds.`,
          error: 'Locked',
        },
        HttpStatus.LOCKED,
      );
      error.getResponse = () => ({
        statusCode: 423,
        message: `Account is locked. Please try again in ${secondsUntilUnlock} seconds.`,
        error: 'Locked',
      });
      error.getStatus = () => 423;
      throw error;
    }

    if (user.deletedAt) {
      throw new ForbiddenException(
        'This account has been deleted. Please contact support to restore your account.',
      );
    }

    const isPasswordValid = await bcrypt.compare(
      loginDto.password,
      user.password,
    );
    if (!isPasswordValid) {
      // Increment failed login attempts
      await this.usersService.incrementFailedLoginAttempts(
        user.id,
        this.maxFailedAttempts,
        this.lockDurationMinutes,
      );
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isEmailVerified) {
      throw new ForbiddenException(
        'Email address not verified. Please check your inbox and verify your email before logging in.',
      );
    }

    // Reset failed login attempts on successful login
    await this.usersService.resetFailedLoginAttempts(user.id);
    if (user.twoFactorEnabled) {
      if (!loginDto.twoFactorCode) {
        return {
          '2fa_required': true,
          message: 'Two-factor authentication code required',
        };
      }

      if (
        !user.twoFactorSecret ||
        !this.verifyTotpCode(
          this.decryptTwoFactorSecret(user.twoFactorSecret),
          loginDto.twoFactorCode,
        )
      ) {
        throw new UnauthorizedException('Invalid two-factor code');
      }
    }

    const payload = { sub: user.id, email: user.email, roles: user.roles };
    const [access_token, refresh_token] = await Promise.all([
      this.jwtService.signAsync(payload),
      this.generateRefreshToken(user.id),
    ]);

    const userWithoutPassword = this.sanitizeUser(user);
    this.logger.info(
      { userId: user.id, email: user.email },
      'User login successful',
    );
    return { access_token, refresh_token, user: userWithoutPassword };
  }

  async enableTwoFactor(
    userId: string,
  ): Promise<{ secret: string; qrCodeUri: string; otpauthUri: string }> {
    const user = await this.usersService.findByIdWithSecrets(userId);
    const secret = this.generateBase32Secret();
    const encryptedSecret = this.encryptTwoFactorSecret(secret);

    await this.usersService.setTwoFactorSecret(user.id, encryptedSecret);

    const otpauthUri = this.buildOtpAuthUri(user.email, secret);
    return { secret, qrCodeUri: otpauthUri, otpauthUri };
  }

  async verifyTwoFactor(
    userId: string,
    dto: TwoFactorCodeDto,
  ): Promise<{ message: string; twoFactorEnabled: boolean }> {
    const user = await this.usersService.findByIdWithSecrets(userId);

    if (!user.twoFactorSecret) {
      throw new BadRequestException('Two-factor authentication is not set up');
    }

    const secret = this.decryptTwoFactorSecret(user.twoFactorSecret);
    if (!this.verifyTotpCode(secret, dto.code)) {
      throw new UnauthorizedException('Invalid two-factor code');
    }

    await this.usersService.enableTwoFactor(user.id);
    return {
      message: 'Two-factor authentication enabled',
      twoFactorEnabled: true,
    };
  }

  async disableTwoFactor(
    userId: string,
    dto: TwoFactorCodeDto,
  ): Promise<{ message: string; twoFactorEnabled: boolean }> {
    const user = await this.usersService.findByIdWithSecrets(userId);

    if (!user.twoFactorEnabled || !user.twoFactorSecret) {
      throw new BadRequestException('Two-factor authentication is not enabled');
    }

    const secret = this.decryptTwoFactorSecret(user.twoFactorSecret);
    if (!this.verifyTotpCode(secret, dto.code)) {
      throw new UnauthorizedException('Invalid two-factor code');
    }

    await this.usersService.disableTwoFactor(user.id);
    return {
      message: 'Two-factor authentication disabled',
      twoFactorEnabled: false,
    };
  }

  async verifyEmail(token: string): Promise<{ message: string }> {
    let payload: { sub: string; purpose: string };
    try {
      payload = this.jwtService.verify(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired verification token');
    }

    if (payload.purpose !== 'email-verification') {
      throw new UnauthorizedException('Invalid or expired verification token');
    }

    await this.usersService.verifyEmail(payload.sub);
    this.logger.info({ userId: payload.sub }, 'Email verified successfully');

    return { message: 'Email verified successfully. You can now log in.' };
  }

  async refresh(
    rawToken: string,
  ): Promise<{ access_token: string; refresh_token: string }> {
    const hashedToken = createHash('sha256').update(rawToken).digest('hex');

    return this.dataSource.transaction(async (manager) => {
      const tokenRecord = await manager.findOne(RefreshToken, {
        where: { token: hashedToken },
        lock: { mode: 'pessimistic_write' },
      });

      if (!tokenRecord || tokenRecord.expiresAt < new Date()) {
        throw new UnauthorizedException('Invalid or expired refresh token');
      }

      if (tokenRecord.revoked) {
        await manager.update(
          RefreshToken,
          { userId: tokenRecord.userId },
          { revoked: true },
        );
        this.logger.warn(
          { userId: tokenRecord.userId },
          'Refresh token reuse detected — all sessions revoked',
        );
        throw new UnauthorizedException('Invalid or expired refresh token');
      }

      const user = await this.usersService
        .findOne(tokenRecord.userId)
        .catch(() => null);
      if (!user) {
        throw new UnauthorizedException('Invalid or expired refresh token');
      }

      await manager.update(RefreshToken, { id: tokenRecord.id }, { revoked: true });

      const payload = { sub: user.id, email: user.email, roles: user.roles };
      const [access_token, refresh_token] = await Promise.all([
        this.jwtService.signAsync(payload),
        this.generateRefreshToken(user.id, manager),
      ]);

      return { access_token, refresh_token };
    });
  }

  async logout(rawToken: string): Promise<void> {
    const hashedToken = createHash('sha256').update(rawToken).digest('hex');
    await this.refreshTokenRepository.update(
      { token: hashedToken },
      { revoked: true },
    );
  }

  async validateUser(
    userId: string,
  ): Promise<Omit<User, 'password' | 'twoFactorSecret'> | null> {
    const user = await this.usersService.findOne(userId).catch(() => null);
    if (!user) {
      return null;
    }
    return this.sanitizeUser(user as User);
  }

  private async generateRefreshToken(
    userId: string,
    manager?: EntityManager,
  ): Promise<string> {
    const rawToken = randomUUID();
    const hashedToken = createHash('sha256').update(rawToken).digest('hex');

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    const repo = manager
      ? manager.getRepository(RefreshToken)
      : this.refreshTokenRepository;

    await repo.save({ token: hashedToken, userId, expiresAt, revoked: false });

    return rawToken;
  }

  private sanitizeUser(user: User): Omit<User, 'password' | 'twoFactorSecret'> {
    const { password, twoFactorSecret, ...safeUser } = user;
    return safeUser;
  }

  private generateBase32Secret(): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = '';
    let secret = '';

    for (const byte of randomBytes(20)) {
      bits += byte.toString(2).padStart(8, '0');
    }

    for (let index = 0; index + 5 <= bits.length; index += 5) {
      secret += alphabet[parseInt(bits.slice(index, index + 5), 2)];
    }

    return secret;
  }

  private buildOtpAuthUri(email: string, secret: string): string {
    const label = encodeURIComponent(`${this.twoFactorIssuer}:${email}`);
    const issuer = encodeURIComponent(this.twoFactorIssuer);
    return `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
  }

  private encryptTwoFactorSecret(secret: string): string {
    const key = this.getTwoFactorEncryptionKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([
      cipher.update(secret, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    return [iv, tag, encrypted]
      .map((part) => part.toString('base64url'))
      .join('.');
  }

  private decryptTwoFactorSecret(encryptedSecret: string): string {
    const [ivText, tagText, encryptedText] = encryptedSecret.split('.');
    if (!ivText || !tagText || !encryptedText) {
      throw new UnauthorizedException('Invalid two-factor code');
    }

    const key = this.getTwoFactorEncryptionKey();
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(ivText, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));

    return Buffer.concat([
      decipher.update(Buffer.from(encryptedText, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  private getTwoFactorEncryptionKey(): Buffer {
    const secret =
      this.configService.get<string>('TWO_FACTOR_ENCRYPTION_KEY') ||
      this.configService.get<string>('JWT_SECRET') ||
      'your-secret-key';

    return createHash('sha256').update(secret).digest();
  }

  private verifyTotpCode(secret: string, code: string): boolean {
    return [-1, 0, 1].some(
      (windowOffset) => this.generateTotpCode(secret, windowOffset) === code,
    );
  }

  private generateTotpCode(secret: string, windowOffset = 0): string {
    const timeStep = Math.floor(Date.now() / 1000 / 30) + windowOffset;
    const counter = Buffer.alloc(8);
    counter.writeUInt32BE(Math.floor(timeStep / 0x100000000), 0);
    counter.writeUInt32BE(timeStep & 0xffffffff, 4);

    const hmac = createHmac('sha1', this.base32ToBuffer(secret))
      .update(counter)
      .digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const binary =
      ((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff);

    return String(binary % 1000000).padStart(6, '0');
  }

  private base32ToBuffer(secret: string): Buffer {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const cleanSecret = secret.toUpperCase().replace(/=+$/g, '');
    let bits = '';

    for (const character of cleanSecret) {
      const value = alphabet.indexOf(character);
      if (value === -1) {
        throw new UnauthorizedException('Invalid two-factor code');
      }
      bits += value.toString(2).padStart(5, '0');
    }

    const bytes: number[] = [];
    for (let index = 0; index + 8 <= bits.length; index += 8) {
      bytes.push(parseInt(bits.slice(index, index + 8), 2));
    }

    return Buffer.from(bytes);
  }

  async forgotPassword(
    forgotPasswordDto: ForgotPasswordDto,
  ): Promise<{ message: string }> {
    const user = await this.usersService.findByEmail(forgotPasswordDto.email);

    if (!user) {
      this.logger.info(
        { email: forgotPasswordDto.email },
        'Password reset requested for non-existent email',
      );
      return {
        message:
          'If an account with that email exists, a password reset link has been sent.',
      };
    }

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');

    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 1);

    await this.passwordResetTokenRepository.save({
      userId: user.id,
      tokenHash,
      expiresAt,
      used: false,
    });

    try {
      await this.mailService.sendPasswordResetEmail(user.email, rawToken);
      this.logger.info(
        { userId: user.id, email: user.email },
        'Password reset email sent',
      );
    } catch (err) {
      this.logger.error(
        { userId: user.id, error: err.message },
        'Failed to send password reset email',
      );
    }

    return {
      message:
        'If an account with that email exists, a password reset link has been sent.',
    };
  }

  async resetPassword(
    resetPasswordDto: ResetPasswordDto,
  ): Promise<{ message: string }> {
    const tokenHash = createHash('sha256')
      .update(resetPasswordDto.token)
      .digest('hex');

    const tokenRecord = await this.passwordResetTokenRepository.findOne({
      where: { tokenHash },
    });

    if (
      !tokenRecord ||
      tokenRecord.used ||
      tokenRecord.expiresAt < new Date()
    ) {
      throw new BadRequestException('Invalid or expired password reset token');
    }

    const user = await this.usersService
      .findOne(tokenRecord.userId)
      .catch(() => null);

    if (!user || user.email !== resetPasswordDto.email) {
      throw new BadRequestException('Invalid or expired password reset token');
    }

    const hashedPassword = await bcrypt.hash(resetPasswordDto.newPassword, 10);
    await this.usersService.updatePassword(user.id, hashedPassword);

    await this.passwordResetTokenRepository.update(
      { tokenHash },
      { used: true },
    );

    await this.refreshTokenRepository.update(
      { userId: user.id },
      { revoked: true },
    );

    this.logger.info(
      { userId: user.id, email: user.email },
      'Password reset successful, all sessions invalidated',
    );

    return { message: 'Password reset successful. Please log in again.' };
  }
}
