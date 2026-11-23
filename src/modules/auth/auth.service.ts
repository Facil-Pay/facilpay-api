import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
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
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { TwoFactorCodeDto } from './dto/two-factor-code.dto';
import { DisableTwoFactorDto } from './dto/disable-two-factor.dto';
import { RegenerateBackupCodesDto } from './dto/regenerate-backup-codes.dto';
import { StepUpDto, StepUpConfirmationDto } from './dto/step-up.dto';
import { generateSecret, generateURI, verifySync } from 'otplib';
import * as qrcode from 'qrcode';
import { UsersService } from '../users/users.service';
import { AppLogger } from '../logger/logger.service';
import { Logger } from 'pino';
import { MerchantSettings } from '../merchants/entities/merchant-settings.entity';
import { MerchantSamlConfig } from './entities/merchant-saml-config.entity';
import { MerchantMember } from '../team/entities/merchant-member.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { Role } from './entities/role.entity';
import { AuditLogsService, RecordAuditLogParams } from '../audit-logs/audit-logs.service';
import { MailService } from './mail/mail.service';
import { PasswordStrengthService } from './password-strength.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { SessionsService } from '../sessions/sessions.service';
import { PasswordHistoryService } from './password-history.service';
import { WebAuthnService } from './webauthn.service';
import { GeoLookupService } from '../merchants/geo-lookup.service';
import { MagicLinkToken } from './entities/magic-link-token.entity';
import { LoginHistoryService } from './login-history.service';
import { LoginAlertsService } from './login-alerts.service';

export interface SessionMetadata {
  ipAddress?: string;
  userAgent?: string;
}

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
    private passwordStrengthService: PasswordStrengthService,
    private passwordHistoryService: PasswordHistoryService,
    private loginHistoryService: LoginHistoryService,
    @InjectRepository(RefreshToken)
    private refreshTokenRepository: Repository<RefreshToken>,
    @InjectRepository(PasswordResetToken)
    private passwordResetTokenRepository: Repository<PasswordResetToken>,
    @InjectRepository(Role)
    private roleRepository: Repository<Role>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private auditLogsService: AuditLogsService,
    private sessionsService: SessionsService,
    private readonly webAuthnService: WebAuthnService,
    private readonly geoLookupService: GeoLookupService,
    private readonly loginAlertsService: LoginAlertsService,
    appLogger: AppLogger,
  ) {
    this.logger = appLogger.child({ module: AuthService.name });
    this.maxFailedAttempts = this.configService.get<number>('LOGIN_MAX_ATTEMPTS', 5);
    this.lockDurationMinutes = this.configService.get<number>('LOGIN_LOCK_DURATION_MINUTES', 15);
  }

  async requestMagicLink(email: string, ipAddress?: string): Promise<{ message: string }> {
    email = email.trim().toLowerCase();
    // Shared database counters apply independently to email and IP across workers.
    await this.dataSource.transaction(async manager => {
      for (const identity of ['email:' + email, 'ip:' + (ipAddress ?? 'unknown')]) {
        const key = createHash('sha256').update(identity).digest('hex');
        const rows = await manager.query(`
          INSERT INTO magic_link_rate_limits (key, count, "expiresAt")
          VALUES ($1, 1, NOW() + INTERVAL '15 minutes')
          ON CONFLICT (key) DO UPDATE SET
            count = CASE WHEN magic_link_rate_limits."expiresAt" <= NOW() THEN 1 ELSE magic_link_rate_limits.count + 1 END,
            "expiresAt" = CASE WHEN magic_link_rate_limits."expiresAt" <= NOW() THEN NOW() + INTERVAL '15 minutes' ELSE magic_link_rate_limits."expiresAt" END
          RETURNING count`, [key]);
        if (Number(rows[0].count) > 5) throw new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS);
      }
    });
    const response = { message: 'If an eligible account with that email exists, a sign-in link has been sent.' };
    const user = await this.usersService.findByEmail(email);
    if (!user || !user.isActive || user.deletedAt || !user.isEmailVerified || user.passwordResetRequired || this.usersService.isAccountLocked(user)) return response;
    const token = await this.jwtService.signAsync({ sub: user.id, purpose: 'magic-link', jti: randomUUID() }, { expiresIn: '15m' });
    await this.dataSource.getRepository(MagicLinkToken).save({
      userId: user.id, tokenHash: createHash('sha256').update(token).digest('hex'),
      expiresAt: new Date(Date.now() + 15 * 60000), used: false,
    });
    try {
      await this.mailService.sendMagicLinkEmail(user.email, token);
    } catch {
      this.logger.warn({ userId: user.id }, 'Could not send magic-link email');
    }
    return response;
  }

  async verifyMagicLink(token: string, ipAddress?: string, userAgent?: string, deviceId?: string, twoFactorCode?: string) {
    let payload: { sub: string; purpose: string };
    try {
      payload = await this.jwtService.verifyAsync(token);
      if (!['magic-link', 'two-factor-login'].includes(payload.purpose) || typeof payload.sub !== 'string') throw new Error();
    } catch {
      throw new UnauthorizedException('Invalid or expired sign-in link');
    }
    const user = await this.usersService.findByIdWithSecrets(payload.sub).catch(() => null);
    if (!user || !user.isActive || user.deletedAt || !user.isEmailVerified || user.passwordResetRequired || this.usersService.isAccountLocked(user)) {
      throw new UnauthorizedException('Invalid or expired sign-in link');
    }
    await this.assertPasswordLoginAllowed(user.id);
    if (payload.purpose === 'two-factor-login') {
      if (!twoFactorCode || !user.twoFactorEnabled || !user.twoFactorSecret) throw new UnauthorizedException('Invalid two-factor code');
      const valid = twoFactorCode.length === 6 && verifySync({ token: twoFactorCode, secret: this.decryptTwoFactorSecret(user.twoFactorSecret) }).valid;
      if (!valid && !await this.usersService.consumeBackupCode(user.id, twoFactorCode)) {
        await this.usersService.incrementFailedLoginAttempts(user.id, this.maxFailedAttempts, this.lockDurationMinutes);
        throw new UnauthorizedException('Invalid two-factor code');
      }
    }
    const result = await this.dataSource.getRepository(MagicLinkToken).createQueryBuilder()
      .update().set({ used: true })
      .where('"tokenHash" = :hash', { hash: createHash('sha256').update(token).digest('hex') })
      .andWhere('"userId" = :userId', { userId: user.id })
      .andWhere('used = false').andWhere('"expiresAt" > :now', { now: new Date() }).execute();
    if (result.affected !== 1) throw new UnauthorizedException('Invalid or expired sign-in link');
    const hasPasskeys = await this.webAuthnService.hasCredentials(user.id);
    if (payload.purpose === 'magic-link' && (user.twoFactorEnabled || hasPasskeys)) {
      const twoFactorToken = await this.jwtService.signAsync({ sub: user.id, purpose: 'two-factor-login', jti: randomUUID(), ...(deviceId ? { deviceId } : {}) }, { expiresIn: '5m' });
      await this.dataSource.getRepository(MagicLinkToken).save({ userId: user.id, tokenHash: createHash('sha256').update(twoFactorToken).digest('hex'), expiresAt: new Date(Date.now() + 5 * 60000), used: false });
      return {
        '2fa_required': true,
        twoFactorToken,
        availableMethods: [...(user.twoFactorEnabled && user.twoFactorSecret ? ['totp'] : []), ...(hasPasskeys ? ['passkey'] : [])],
      };
    }
    return this.completeLogin(user, ipAddress, userAgent, deviceId);
  }

  async register(
    registerDto: RegisterDto,
  ): Promise<{ message: string; user: Omit<User, 'password'>; passwordStrength: { score: number } }> {
    const existingUser = await this.usersService.findByEmail(registerDto.email);
    if (existingUser) {
      throw new UnauthorizedException('User already exists');
    }

    const { score } = await this.passwordStrengthService.validateAndScore(registerDto.password);

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
      passwordStrength: { score },
    };
  }

  async login(
    loginDto: LoginDto,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{
    access_token?: string;
    refresh_token?: string;
    user?: Omit<User, 'password' | 'twoFactorSecret'>;
    '2fa_required'?: boolean;
    twoFactorToken?: string;
    availableMethods?: string[];
    message?: string;
  }> {
    const user = await this.usersService.findByEmail(loginDto.email);
    if (!user) {
      await this.auditLogsService.record({
        actorId: null,
        actorType: 'user',
        action: 'auth.login.failed',
        resourceType: 'user',
        resourceId: null,
        ipAddress,
        userAgent,
        metadata: { email: loginDto.email, reason: 'user_not_found' },
      });
      await this.loginHistoryService.record({
        userId: null,
        success: false,
        reason: 'user_not_found',
        ipAddress,
        userAgent,
      });
      throw new UnauthorizedException('Invalid credentials');
    }

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

    if (user.passwordResetRequired) {
      throw new ForbiddenException(
        'A password reset is required before you can sign in.',
      );
    }

    await this.assertPasswordLoginAllowed(user.id);

    const isPasswordValid = await bcrypt.compare(
      loginDto.password,
      user.password,
    );
    if (!isPasswordValid) {
      await this.usersService.incrementFailedLoginAttempts(
        user.id,
        this.maxFailedAttempts,
        this.lockDurationMinutes,
      );
      await this.auditLogsService.record({
        actorId: user.id,
        actorType: 'user',
        action: 'auth.login.failed',
        resourceType: 'user',
        resourceId: user.id,
        ipAddress,
        userAgent,
        metadata: { email: user.email, reason: 'invalid_password' },
      });
      await this.loginHistoryService.record({
        userId: user.id,
        success: false,
        reason: 'bad_password',
        ipAddress,
        userAgent,
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isEmailVerified) {
      await this.loginHistoryService.record({
        userId: user.id,
        success: false,
        reason: 'email_not_verified',
        ipAddress,
        userAgent,
      });
      throw new ForbiddenException(
        'Email address not verified. Please check your inbox and verify your email before logging in.',
      );
    }

    await this.usersService.resetFailedLoginAttempts(user.id);

    const hasPasskeys = await this.webAuthnService.hasCredentials(user.id);
    if (user.twoFactorEnabled || hasPasskeys) {
      if (!loginDto.twoFactorCode) {
        return {
          '2fa_required': true,
          message: 'Two-factor authentication code required',
          twoFactorToken: await this.jwtService.signAsync(
            {
              sub: user.id,
              purpose: 'two-factor-login',
              ...(loginDto.deviceId ? { deviceId: loginDto.deviceId } : {}),
            },
            { expiresIn: '5m' },
          ),
          availableMethods: [
            ...(user.twoFactorEnabled && user.twoFactorSecret ? ['totp'] : []),
            ...(hasPasskeys ? ['passkey'] : []),
          ],
        };
      }

      if (!user.twoFactorSecret) {
        throw new UnauthorizedException('Invalid two-factor code');
      }

      const secret = this.decryptTwoFactorSecret(user.twoFactorSecret);
      const isTotpValid = loginDto.twoFactorCode.length === 6 ? verifySync({ token: loginDto.twoFactorCode, secret }).valid : false;

      if (!isTotpValid) {
        const isBackupCodeValid = await this.usersService.consumeBackupCode(user.id, loginDto.twoFactorCode);
        if (!isBackupCodeValid) {
          await this.auditLogsService.record({
            actorId: user.id,
            actorType: 'user',
            action: 'auth.login.failed',
            resourceType: 'user',
            resourceId: user.id,
            ipAddress,
            userAgent,
            metadata: { email: user.email, reason: 'invalid_2fa' },
          });
          await this.loginHistoryService.record({
            userId: user.id,
            success: false,
            reason: '2fa_failed',
            ipAddress,
            userAgent,
          });
          throw new UnauthorizedException('Invalid two-factor code');
        }
      }
    }

    return this.completeLogin(user, ipAddress, userAgent, loginDto.deviceId);
  }

  async completePasskeyLogin(
    userId: string,
    ipAddress?: string,
    userAgent?: string,
    deviceId?: string,
  ) {
    const user = await this.usersService.findByIdWithSecrets(userId);
    if (
      user.deletedAt ||
      !user.isActive ||
      !user.isEmailVerified ||
      user.passwordResetRequired ||
      this.usersService.isAccountLocked(user)
    ) {
      throw new UnauthorizedException('Passkey login is not available for this account');
    }
    await this.assertPasswordLoginAllowed(user.id);
    return this.completeLogin(user, ipAddress, userAgent, deviceId);
  }

  private async assertPasswordLoginAllowed(userId: string): Promise<void> {
    const memberships = await this.dataSource.getRepository(MerchantMember).findBy({ userId });
    for (const merchantId of [userId, ...memberships.map(member => member.merchantId)]) {
      if (await this.dataSource.getRepository(MerchantSamlConfig).existsBy({ merchantId, requireSso: true })) {
        throw new ForbiddenException('Your merchant team requires SAML SSO');
      }
    }
  }

  async completeSsoLogin(user: User, ipAddress?: string, userAgent?: string) {
    if (!user.isActive || user.deletedAt || user.status === 'SUSPENDED') throw new ForbiddenException('Account is unavailable');
    return this.completeLogin(user, ipAddress, userAgent);
  }

  private async completeLogin(
    user: User,
    ipAddress?: string,
    userAgent?: string,
    deviceId?: string,
  ) {
    const deviceIdentity = deviceId?.trim() || userAgent?.trim();
    const deviceFingerprint = deviceIdentity
      ? createHash('sha256')
          .update(`${userAgent ?? ''}\0${deviceIdentity}`)
          .digest('hex')
      : null;
    const countryCode = ipAddress
      ? this.geoLookupService.lookupCountry(ipAddress)
      : null;
    const session = await this.sessionsService.createSession(
      user.id,
      ipAddress,
      userAgent,
      { deviceFingerprint, countryCode },
    );
    const payload = { sub: user.id, email: user.email, roles: user.roles, sid: session.id };
    const [access_token, refresh_token] = await Promise.all([
      this.jwtService.signAsync(payload),
      this.generateRefreshToken(user.id, undefined, session.id),
    ]);
    const userWithoutPassword = this.sanitizeUser(user);

    this.logger.info(
      { userId: user.id, email: user.email },
      'User login successful',
    );
    await this.auditLogsService.record({
      actorId: user.id,
      actorType: 'user',
      action: 'auth.login.success',
      resourceType: 'user',
      resourceId: user.id,
      ipAddress,
      userAgent,
      metadata: { email: user.email },
    });
    try {
      await this.loginAlertsService.sendAlertIfNeeded(user, session);
    } catch (error) {
      this.logger.warn(
        {
          userId: user.id,
          error: error instanceof Error ? error.message : String(error),
        },
        'Could not send new-login security alert',
      );
    }
    return { access_token, refresh_token, user: userWithoutPassword };
  }

  async completeOAuthLogin(
    userId: string,
    ipAddress?: string,
    userAgent?: string,
  ) {
    const user = await this.usersService.findByIdWithSecrets(userId);
    if (!user || user.deletedAt || !user.isActive) {
      throw new UnauthorizedException('OAuth login is not available for this account');
    }
    if (this.usersService.isAccountLocked(user)) {
      throw new ForbiddenException('Account is locked. Please try again later.');
    }
    await this.assertPasswordLoginAllowed(user.id);
    return this.completeLogin(user, ipAddress, userAgent);
  }

  async enableTwoFactor(
    userId: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{ secret: string; qrCodeUri: string; otpauthUri: string; backupCodes: string[] }> {
    const user = await this.usersService.findByIdWithSecrets(userId);
    const secret = generateSecret();
    const encryptedSecret = this.encryptTwoFactorSecret(secret);

    await this.usersService.setTwoFactorSecret(user.id, encryptedSecret);

    const otpauthUri = generateURI({
      label: user.email,
      issuer: this.twoFactorIssuer,
      secret,
      algorithm: 'sha1',
      digits: 6,
      period: 30,
    });
    const qrCodeUri = await qrcode.toDataURL(otpauthUri);

    const plainBackupCodes = Array.from({ length: 10 }, () => randomBytes(4).toString('hex'));
    const hashedBackupCodes = await Promise.all(
      plainBackupCodes.map(code => bcrypt.hash(code, 10))
    );
    await this.usersService.updateBackupCodes(user.id, hashedBackupCodes);

    await this.auditLogsService.record({
      actorId: user.id,
      actorType: 'user',
      action: 'auth.two_factor.setup_started',
      resourceType: 'user',
      resourceId: user.id,
      ipAddress,
      userAgent,
      metadata: { email: user.email },
    });

    return { secret, qrCodeUri, otpauthUri, backupCodes: plainBackupCodes };
  }

  async verifyTwoFactor(
    userId: string,
    dto: TwoFactorCodeDto,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{ message: string; twoFactorEnabled: boolean }> {
    const user = await this.usersService.findByIdWithSecrets(userId);

    if (!user.twoFactorSecret) {
      throw new BadRequestException('Two-factor authentication is not set up');
    }

    // Enforce account lockout — same protection as login/disableTwoFactor
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

    const secret = this.decryptTwoFactorSecret(user.twoFactorSecret);
    const isValid = verifySync({ token: dto.code, secret }).valid;
    if (!isValid) {
      await this.usersService.incrementFailedLoginAttempts(
        user.id,
        this.maxFailedAttempts,
        this.lockDurationMinutes,
      );
      throw new UnauthorizedException('Invalid two-factor code');
    }

    await this.usersService.resetFailedLoginAttempts(user.id);
    await this.usersService.enableTwoFactor(user.id);

    await this.auditLogsService.record({
      actorId: user.id,
      actorType: 'user',
      action: 'auth.two_factor.enabled',
      resourceType: 'user',
      resourceId: user.id,
      ipAddress,
      userAgent,
      metadata: { email: user.email },
    });

    return {
      message: 'Two-factor authentication enabled',
      twoFactorEnabled: true,
    };
  }

  async disableTwoFactor(
    userId: string,
    dto: DisableTwoFactorDto,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{ message: string; twoFactorEnabled: boolean }> {
    const user = await this.usersService.findByIdWithSecrets(userId);

    if (!user.twoFactorEnabled || !user.twoFactorSecret) {
      throw new BadRequestException('Two-factor authentication is not enabled');
    }

    // Check account lockout — same protection as the login path
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

    const isPasswordValid = await bcrypt.compare(dto.password, user.password);
    if (!isPasswordValid) {
      // Track failed attempt through the shared lockout counter
      await this.usersService.incrementFailedLoginAttempts(
        user.id,
        this.maxFailedAttempts,
        this.lockDurationMinutes,
      );
      throw new UnauthorizedException('Invalid password');
    }

    // Reset lockout counter on successful password verification
    await this.usersService.resetFailedLoginAttempts(user.id);

    const memberships = await this.dataSource.getRepository(MerchantMember).findBy({ userId });
    for (const merchantId of [userId, ...memberships.map(member => member.merchantId)]) {
      if (await this.dataSource.getRepository(MerchantSettings).existsBy({ merchantId, require2fa: true }) &&
        !await this.webAuthnService.hasCredentials(userId)) {
        throw new ForbiddenException('Your merchant team requires at least one second factor');
      }
    }
    await this.usersService.disableTwoFactor(user.id);

    await this.auditLogsService.record({
      actorId: user.id,
      actorType: 'user',
      action: 'auth.two_factor.disabled',
      resourceType: 'user',
      resourceId: user.id,
      ipAddress,
      userAgent,
      metadata: { email: user.email },
    });

    return {
      message: 'Two-factor authentication disabled',
      twoFactorEnabled: false,
    };
  }

  /**
   * Perform step-up re-authentication to verify identity before high-value operations.
   * Validates password or TOTP code and returns a short-lived JWT token.
   * Required before: creating/rotating admin-scope API keys, assigning high-privilege roles.
   */
  async stepUp(
    userId: string,
    dto: StepUpDto,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<StepUpConfirmationDto> {
    const user = await this.usersService.findByIdWithSecrets(userId);

    if (!dto.password && !dto.totpCode) {
      throw new BadRequestException('Either password or totpCode is required');
    }

    // Validate password if provided
    if (dto.password) {
      const isPasswordValid = await bcrypt.compare(dto.password, user.password);
      if (!isPasswordValid) {
        throw new UnauthorizedException('Invalid password');
      }
    }

    // Validate TOTP code if provided
    if (dto.totpCode) {
      if (!user.twoFactorEnabled || !user.twoFactorSecret) {
        throw new BadRequestException('Two-factor authentication is not enabled');
      }

      const secret = this.decryptTwoFactorSecret(user.twoFactorSecret);
      const isTotpValid = verifySync({
        token: dto.totpCode,
        secret,
      }).valid;

      if (!isTotpValid) {
        throw new UnauthorizedException('Invalid two-factor code');
      }
    }

    // Generate a short-lived step-up token (5 minutes)
    const stepUpToken = this.jwtService.sign(
      {
        sub: user.id,
        email: user.email,
        purpose: 'step-up',
        roles: user.roles,
      },
      { expiresIn: '5m' },
    );

    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 5);

    await this.auditLogsService.record({
      actorId: user.id,
      actorType: 'user',
      action: 'auth.step_up.confirmed',
      resourceType: 'user',
      resourceId: user.id,
      ipAddress,
      userAgent,
      metadata: {
        email: user.email,
        method: dto.password ? 'password' : 'totp',
      },
    });

    return {
      stepUpToken,
      expiresAt: expiresAt.toISOString(),
      message: 'Step-up authentication confirmed. This token is valid for 5 minutes.',
    };
  }

  validateStepUpToken(token: string, userId: string): void {
    try {
      const payload = this.jwtService.verify<{ sub: string; purpose: string }>(token);
      if (payload.sub !== userId || payload.purpose !== 'step-up') {
        throw new UnauthorizedException('A valid step-up token is required');
      }
    } catch {
      throw new UnauthorizedException('A valid step-up token is required');
    }
  }

  async regenerateBackupCodes(
    userId: string,
    dto: RegenerateBackupCodesDto,
  ): Promise<{ backupCodes: string[] }> {
    return this.dataSource.transaction(async (manager) => {
      const user = await manager.findOne(User, {
        where: { id: userId },
      });
      if (!user) {
        throw new NotFoundException(`User with ID ${userId} not found`);
      }

      if (!user.twoFactorEnabled || !user.twoFactorSecret) {
        throw new BadRequestException(
          'Two-factor authentication is not enabled',
        );
      }

      const hasPassword = dto.password !== undefined && dto.password !== '';
      const hasTotpCode =
        dto.twoFactorCode !== undefined && dto.twoFactorCode !== '';

      if (!hasPassword && !hasTotpCode) {
        throw new BadRequestException(
          'Password or two-factor code is required',
        );
      }

      if (dto.password !== undefined && dto.password !== '') {
        const isPasswordValid = await bcrypt.compare(
          dto.password,
          user.password,
        );
        if (!isPasswordValid) {
          throw new UnauthorizedException('Invalid password');
        }
      }

      if (dto.twoFactorCode !== undefined && dto.twoFactorCode !== '') {
        const secret = this.decryptTwoFactorSecret(user.twoFactorSecret);
        const isTotpValid = verifySync({
          token: dto.twoFactorCode,
          secret,
        }).valid;
        if (!isTotpValid) {
          throw new UnauthorizedException('Invalid two-factor code');
        }
      }

      const plainBackupCodes = Array.from({ length: 10 }, () =>
        randomBytes(4).toString('hex'),
      );
      const hashedBackupCodes = await Promise.all(
        plainBackupCodes.map((code) => bcrypt.hash(code, 10)),
      );

      user.backupCodes = hashedBackupCodes;
      await manager.save(user);

      this.logger.info({ userId }, 'Two-factor backup codes regenerated');

      return { backupCodes: plainBackupCodes };
    });
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

  async resendVerificationEmail(
    resendVerificationDto: ResendVerificationDto,
  ): Promise<{ message: string }> {
    const user = await this.usersService.findByEmail(
      resendVerificationDto.email,
    );

    // Return the same generic message whether the account exists and is
    // unverified or not, to avoid user enumeration (same as forgotPassword).
    if (!user || user.isEmailVerified) {
      this.logger.info(
        { email: resendVerificationDto.email },
        'Verification resend requested for unverifiable account',
      );
      return {
        message:
          'If an account with that email exists, a verification link has been sent.',
      };
    }

    const verificationToken = this.jwtService.sign(
      { sub: user.id, email: user.email, purpose: 'email-verification' },
      { expiresIn: '24h' },
    );

    try {
      await this.mailService.sendVerificationEmail(
        user.email,
        verificationToken,
      );
      this.logger.info(
        { userId: user.id, email: user.email },
        'Verification email resent',
      );
    } catch (err) {
      this.logger.error(
        { userId: user.id, error: err.message },
        'Failed to resend verification email',
      );
    }

    return {
      message:
        'If an account with that email exists, a verification link has been sent.',
    };
  }

  async refresh(
    rawToken: string,
    sessionMeta?: SessionMetadata,
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

      let sessionId = tokenRecord.sessionId;
      if (sessionId) {
        const touched = await this.sessionsService.touchSession(
          sessionId,
          sessionMeta?.ipAddress,
          sessionMeta?.userAgent,
          user.id,
        );
        if (!touched) throw new UnauthorizedException('Session expired or revoked');
      }
      if (!sessionId) {
        const session = await this.sessionsService.createSession(
          user.id,
          sessionMeta?.ipAddress,
          sessionMeta?.userAgent,
        );
        sessionId = session.id;
      }

      await manager.update(RefreshToken, { id: tokenRecord.id }, { revoked: true });

      const payload = { sub: user.id, email: user.email, roles: user.roles, sid: sessionId };
      const [access_token, refresh_token] = await Promise.all([
        this.jwtService.signAsync(payload),
        this.generateRefreshToken(user.id, manager, sessionId),
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
    if (user.passwordResetRequired) return null;
    return this.sanitizeUser(user as User);
  }

  private async generateRefreshToken(
    userId: string,
    manager?: EntityManager,
    sessionId?: string | null,
  ): Promise<string> {
    const rawToken = randomUUID();
    const hashedToken = createHash('sha256').update(rawToken).digest('hex');

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    const repo = manager
      ? manager.getRepository(RefreshToken)
      : this.refreshTokenRepository;

    await repo.save({
      token: hashedToken,
      userId,
      sessionId: sessionId ?? null,
      expiresAt,
      revoked: false,
    });

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
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{ message: string }> {
    const user = await this.usersService.findByEmail(forgotPasswordDto.email);

    if (!user) {
      this.logger.info(
        { email: forgotPasswordDto.email },
        'Password reset requested for non-existent email',
      );
      await this.auditLogsService.record({
        actorId: null,
        actorType: 'system',
        action: 'auth.password.reset_requested',
        resourceType: 'user',
        resourceId: null,
        ipAddress,
        userAgent,
        metadata: { email: forgotPasswordDto.email, reason: 'user_not_found' },
      });
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

    await this.auditLogsService.record({
      actorId: user.id,
      actorType: 'user',
      action: 'auth.password.reset_requested',
      resourceType: 'user',
      resourceId: user.id,
      ipAddress,
      userAgent,
      metadata: { email: user.email },
    });

    return {
      message:
        'If an account with that email exists, a password reset link has been sent.',
    };
  }

  async resetPassword(
    resetPasswordDto: ResetPasswordDto,
    ipAddress?: string,
    userAgent?: string,
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

    await this.passwordStrengthService.validateAndScore(resetPasswordDto.newPassword);

    const hashedPassword = await bcrypt.hash(resetPasswordDto.newPassword, 10);

    // Check if new password matches any recent password in history
    await this.passwordHistoryService.validatePasswordNotReused(user.id, resetPasswordDto.newPassword);

    await this.usersService.updatePassword(user.id, hashedPassword);
    await this.userRepository.update(
      { id: user.id },
      { passwordResetRequired: false },
    );

    // Record the new password in history after successful update
    await this.passwordHistoryService.recordPasswordChange(user.id, hashedPassword);

    try {
      await this.mailService.sendPasswordChangedEmail(user.email);
    } catch (error) {
      this.logger.warn(
        { userId: user.id, email: user.email, error: error.message },
        'Failed to send password changed email',
      );
    }

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

    await this.auditLogsService.record({
      actorId: user.id,
      actorType: 'user',
      action: 'auth.password.reset_completed',
      resourceType: 'user',
      resourceId: user.id,
      ipAddress,
      userAgent,
      metadata: { email: user.email },
    });

    return { message: 'Password reset successful. Please log in again.' };
  }

  async getRoles(): Promise<Pick<Role, 'id' | 'name' | 'permissions' | 'description'>[]> {
    return this.roleRepository.find({
      select: ['id', 'name', 'permissions', 'description'],
      order: { name: 'ASC' },
    });
  }

  async getRoleById(id: string): Promise<Pick<Role, 'id' | 'name' | 'permissions' | 'description'>> {
    const role = await this.roleRepository.findOne({
      where: { id },
      select: ['id', 'name', 'permissions', 'description'],
    });

    if (!role) {
      throw new NotFoundException(`Role with ID ${id} not found`);
    }

    return role;
  }

  async createRole(dto: CreateRoleDto): Promise<Role> {
    const existing = await this.roleRepository.findOne({ where: { name: dto.name } });
    if (existing) {
      throw new BadRequestException('Role with this name already exists');
    }

    const role = this.roleRepository.create(dto);
    return this.roleRepository.save(role);
  }

  async updateRole(id: string, dto: UpdateRoleDto): Promise<Role> {
    const role = await this.roleRepository.findOne({ where: { id } });
    if (!role) {
      throw new NotFoundException(`Role with ID ${id} not found`);
    }

    // Check if trying to rename and another role with that name exists
    if (dto.name && dto.name !== role.name) {
      const existing = await this.roleRepository.findOne({ where: { name: dto.name } });
      if (existing) {
        throw new BadRequestException('Role with this name already exists');
      }
    }

    if (dto.name !== undefined) role.name = dto.name;
    if (dto.permissions !== undefined) role.permissions = dto.permissions;
    if (dto.description !== undefined) role.description = dto.description;

    return this.roleRepository.save(role);
  }

  async deleteRole(id: string): Promise<void> {
    const role = await this.roleRepository.findOne({ where: { id } });
    if (!role) {
      throw new NotFoundException(`Role with ID ${id} not found`);
    }

    // Check if any users have this role
    const usersWithRole = await this.userRepository.count({ where: { roleId: id } });
    if (usersWithRole > 0) {
      throw new BadRequestException(
        `Cannot delete role "${role.name}". ${usersWithRole} user(s) currently have this role assigned.`,
      );
    }

    await this.roleRepository.remove(role);
  }

  async assignRole(
    userId: string,
    roleId: string,
    actorId?: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<User> {
    const user = await this.usersService.findOne(userId);
    if (!user) {
      throw new BadRequestException('User not found');
    }

    const role = await this.roleRepository.findOne({ where: { id: roleId } });
    if (!role) {
      throw new BadRequestException('Role not found');
    }

    user.roleId = roleId;
    const updatedUser = await this.userRepository.save(user);

    await this.auditLogsService.record({
      actorId: actorId ?? null,
      actorType: actorId ? 'user' : 'system',
      action: 'auth.role.assigned',
      resourceType: 'user',
      resourceId: userId,
      ipAddress,
      userAgent,
      metadata: {
        targetUserId: userId,
        targetEmail: (user as any).email,
        roleId,
        roleName: role.name,
      },
    });

    return updatedUser;
  }
}
