// otplib uses ESM dependencies that Jest cannot transform — mock it entirely
jest.mock('otplib', () => ({
  authenticator: {
    generateSecret: jest.fn().mockReturnValue('MOCKSECRET'),
    keyuri: jest.fn().mockReturnValue('otpauth://totp/mock'),
    verify: jest.fn().mockReturnValue(false),
  },
  generateSecret: jest.fn().mockReturnValue('MOCKSECRET'),
  generateURI: jest.fn().mockReturnValue('otpauth://totp/mock'),
  verifySync: jest.fn().mockReturnValue({ valid: false }),
}));

jest.mock('bcrypt');

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PasswordHistoryService } from './password-history.service';
import { SessionsService } from '../sessions/sessions.service';
import { RefreshToken } from './entities/refresh-token.entity';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { Role } from './entities/role.entity';
import { User } from '../users/user.entity';
import {
  UnauthorizedException,
  BadRequestException,
  HttpException,
} from '@nestjs/common';
import { AppLogger } from '../logger/logger.service';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as otplib from 'otplib';
import { PasswordStrengthService } from './password-strength.service';
import { LoginHistoryService } from './login-history.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { WebAuthnService } from './webauthn.service';
import { GeoLookupService } from '../merchants/geo-lookup.service';
import { LoginAlertsService } from './login-alerts.service';

describe('AuthService', () => {
  let service: AuthService;
  let usersService: UsersService;
  let jwtService: JwtService;

  const mockUsersService = {
    findByEmail: jest.fn(),
    create: jest.fn(),
    findOne: jest.fn(),
    findByIdWithSecrets: jest.fn(),
    setTwoFactorSecret: jest.fn(),
    enableTwoFactor: jest.fn(),
    disableTwoFactor: jest.fn(),
    isAccountLocked: jest.fn().mockReturnValue(false),
    resetFailedLoginAttempts: jest.fn().mockResolvedValue(undefined),
    getSecondsUntilUnlock: jest.fn().mockReturnValue(0),
    incrementFailedLoginAttempts: jest.fn().mockResolvedValue(1),
    updateBackupCodes: jest.fn().mockResolvedValue(undefined),
    consumeBackupCode: jest.fn().mockResolvedValue(false),
  };

  const mockJwtService = {
    sign: jest.fn(),
    signAsync: jest.fn(),
  };

  const mockAppLogger = {
    child: jest.fn(() => ({
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
    })),
  };

  const mockMailService = {
    sendVerificationEmail: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue?: unknown) => {
      if (key === 'TWO_FACTOR_ENCRYPTION_KEY') return 'test-two-factor-encryption-key-32chars!';
      if (key === 'LOGIN_MAX_ATTEMPTS') return 5;
      if (key === 'LOGIN_LOCK_DURATION_MINUTES') return 15;
      return defaultValue ?? undefined;
    }),
  };

  const mockManager = {
    findOne: jest.fn(),
    update: jest.fn(),
    save: jest.fn(),
    getRepository: jest.fn(() => ({ save: jest.fn().mockResolvedValue({}) })),
  };

  const mockDataSource = {
    getRepository: jest.fn(() => ({ findBy: jest.fn().mockResolvedValue([]), existsBy: jest.fn().mockResolvedValue(false) })),
    transaction: jest.fn(<T>(cb: (manager: typeof mockManager) => Promise<T>) =>
      cb(mockManager),
    ),
  };

  const mockAuditLogsService = {
    record: jest.fn(),
  };

  const mockWebAuthnService = {
    hasCredentials: jest.fn().mockResolvedValue(false),
  };
  const mockGeoLookupService = {
    lookupCountry: jest.fn().mockReturnValue(null),
  };
  const mockLoginAlertsService = {
    sendAlertIfNeeded: jest.fn().mockResolvedValue(false),
  };

  beforeEach(async () => {
    mockWebAuthnService.hasCredentials.mockResolvedValue(false);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: LoginHistoryService, useValue: { record: jest.fn().mockResolvedValue({}) } },
        {
          provide: UsersService,
          useValue: mockUsersService,
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: AppLogger,
          useValue: mockAppLogger,
        },
        {
          provide: require('./mail/mail.service').MailService,
          useValue: mockMailService,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: 'RefreshTokenRepository',
          useValue: { save: jest.fn().mockResolvedValue({}) },
        },
        {
          provide: 'PasswordResetTokenRepository',
          useValue: { save: jest.fn().mockResolvedValue({}) },
        },
        {
          provide: 'RoleRepository',
          useValue: { findOne: jest.fn(), create: jest.fn(), save: jest.fn() },
        },
        {
          provide: require('./password-strength.service').PasswordStrengthService,
          useValue: { validateAndScore: jest.fn().mockResolvedValue({ score: 3 }) },
        },
        {
          provide: PasswordHistoryService,
          useValue: {
            validatePasswordNotReused: jest.fn().mockResolvedValue(undefined),
            recordPasswordChange: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: SessionsService,
          useValue: {
            createSession: jest.fn().mockResolvedValue({ id: 'sess-id' }),
            touchSession: jest.fn().mockResolvedValue(true),
          },
        },
        {
          provide: getRepositoryToken(RefreshToken),
          useValue: { save: jest.fn().mockResolvedValue({}), findOne: jest.fn(), update: jest.fn() },
        },
        {
          provide: getRepositoryToken(PasswordResetToken),
          useValue: { save: jest.fn().mockResolvedValue({}), findOne: jest.fn(), update: jest.fn() },
        },
        {
          provide: getRepositoryToken(Role),
          useValue: { findOne: jest.fn(), create: jest.fn(), save: jest.fn(), find: jest.fn() },
        },
        {
          provide: getRepositoryToken(User),
          useValue: {
            findOne: jest.fn(),
            save: jest.fn(),
            update: jest.fn().mockResolvedValue({ affected: 1 }),
          },
        },
        {
          provide: AuditLogsService,
          useValue: mockAuditLogsService,
        },
        {
          provide: WebAuthnService,
          useValue: mockWebAuthnService,
        },
        { provide: GeoLookupService, useValue: mockGeoLookupService },
        { provide: LoginAlertsService, useValue: mockLoginAlertsService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    usersService = module.get<UsersService>(UsersService);
    jwtService = module.get<JwtService>(JwtService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('register', () => {
    it('should register a new user successfully', async () => {
      const registerDto = {
        email: 'test@example.com',
        password: 'password123',
      };

      const createdUser = {
        id: '123',
        email: 'test@example.com',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockUsersService.findByEmail.mockResolvedValue(null);
      mockUsersService.create.mockResolvedValue(createdUser);

      const result = await service.register(registerDto);

      expect(usersService.findByEmail).toHaveBeenCalledWith(registerDto.email);
      expect(usersService.create).toHaveBeenCalledWith(registerDto);
      expect(result).toMatchObject({
        message:
          'User registered successfully. Please check your email to verify your account.',
        user: createdUser,
        passwordStrength: { score: 3 },
      });
    });

    it('should throw UnauthorizedException if user already exists', async () => {
      const registerDto = {
        email: 'existing@example.com',
        password: 'password123',
      };

      const existingUser = {
        id: '123',
        email: 'existing@example.com',
        password: 'hashedpassword',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockUsersService.findByEmail.mockResolvedValue(existingUser);

      await expect(service.register(registerDto)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.register(registerDto)).rejects.toThrow(
        'User already exists',
      );
      expect(usersService.create).not.toHaveBeenCalled();
    });

    it('should throw User already exists when registering a case-variant duplicate', async () => {
      const registerDto = {
        email: '  Jane@Example.COM  ',
        password: 'Password123!',
      };

      const existingUser = {
        id: 'user-existing',
        email: 'jane@example.com',
        password: 'hashedpassword',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockUsersService.findByEmail.mockResolvedValue(existingUser);

      await expect(service.register(registerDto)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.register(registerDto)).rejects.toThrow(
        'User already exists',
      );
      expect(usersService.findByEmail).toHaveBeenCalledWith(registerDto.email);
      expect(usersService.create).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('blocks login until a required password reset is completed', async () => {
      mockUsersService.findByEmail.mockResolvedValue({
        id: 'reset-required-user',
        email: 'reset@example.com',
        password: 'hashed-password',
        isEmailVerified: true,
        passwordResetRequired: true,
      });

      await expect(
        service.login({ email: 'reset@example.com', password: 'password' }),
      ).rejects.toThrow('A password reset is required before you can sign in.');
      expect(bcrypt.compare).not.toHaveBeenCalled();
    });

    it('returns a short-lived second-factor token when a passkey is registered', async () => {
      const user = {
        id: 'passkey-user',
        email: 'passkey@example.com',
        password: 'hashed-password',
        isEmailVerified: true,
        isActive: true,
        twoFactorEnabled: false,
        twoFactorSecret: null,
      };
      mockUsersService.findByEmail.mockResolvedValue(user);
      mockWebAuthnService.hasCredentials.mockResolvedValue(true);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      mockJwtService.signAsync.mockResolvedValue('short-lived-2fa-token');

      const result = await service.login({
        email: user.email,
        password: 'correct-password',
      });

      expect(result).toMatchObject({
        '2fa_required': true,
        twoFactorToken: 'short-lived-2fa-token',
        availableMethods: ['passkey'],
      });
      expect(jwtService.signAsync).toHaveBeenCalledWith(
        { sub: user.id, purpose: 'two-factor-login' },
        { expiresIn: '5m' },
      );
    });

    it('should login user and return access token', async () => {
      const loginDto = {
        email: 'test@example.com',
        password: 'password123',
      };

      const user = {
        id: '123',
        email: 'test@example.com',
        password: 'hashedpassword',
        createdAt: new Date(),
        updatedAt: new Date(),
        isEmailVerified: true,
      };

      mockUsersService.findByEmail.mockResolvedValue(user);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      mockJwtService.sign.mockReturnValue('jwt-token-123');
      mockJwtService.signAsync.mockResolvedValue('jwt-token-123');

      const result = await service.login(loginDto);

      expect(usersService.findByEmail).toHaveBeenCalledWith(loginDto.email);
      expect(bcrypt.compare).toHaveBeenCalledWith(
        loginDto.password,
        user.password,
      );
      expect(jwtService.signAsync).toHaveBeenCalledWith({
        sub: user.id,
        email: user.email,
      });
      expect(result).toMatchObject({
        access_token: 'jwt-token-123',
        refresh_token: expect.any(String),
        user: {
          id: user.id,
          email: user.email,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
          isEmailVerified: true,
        },
      });
      expect(result.user).not.toHaveProperty('password');
    });

    it('should throw UnauthorizedException if user not found', async () => {
      const loginDto = {
        email: 'nonexistent@example.com',
        password: 'password123',
      };

      mockUsersService.findByEmail.mockResolvedValue(null);

      await expect(service.login(loginDto)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.login(loginDto)).rejects.toThrow(
        'Invalid credentials',
      );
      expect(bcrypt.compare).not.toHaveBeenCalled();
      expect(jwtService.sign).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException if password is invalid', async () => {
      const loginDto = {
        email: 'test@example.com',
        password: 'wrongpassword',
      };

      const user = {
        id: '123',
        email: 'test@example.com',
        password: 'hashedpassword',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockUsersService.findByEmail.mockResolvedValue(user);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login(loginDto)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(service.login(loginDto)).rejects.toThrow(
        'Invalid credentials',
      );
      expect(jwtService.sign).not.toHaveBeenCalled();
    });

    it('should login successfully with case-variant email', async () => {
      const loginDto = {
        email: '  TEST@Example.COM  ',
        password: 'password123',
      };

      const storedUser = {
        id: '123',
        email: 'test@example.com',
        password: 'hashedpassword',
        createdAt: new Date(),
        updatedAt: new Date(),
        isEmailVerified: true,
      };

      mockUsersService.findByEmail.mockResolvedValue(storedUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      mockJwtService.sign.mockReturnValue('jwt-token-123');
      mockJwtService.signAsync.mockResolvedValue('jwt-token-123');

      const result = await service.login(loginDto);

      expect(usersService.findByEmail).toHaveBeenCalledWith(loginDto.email);
      expect(bcrypt.compare).toHaveBeenCalledWith(
        loginDto.password,
        storedUser.password,
      );
      expect(result).toMatchObject({
        access_token: 'jwt-token-123',
        refresh_token: expect.any(String),
        user: expect.objectContaining({
          id: storedUser.id,
          email: storedUser.email,
          isEmailVerified: true,
        }),
      });
    });
  });

  describe('validateUser', () => {
    it('should return user without password if found', async () => {
      const userId = '123';
      const user = {
        id: userId,
        email: 'test@example.com',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockUsersService.findOne.mockResolvedValue(user);

      const result = await service.validateUser(userId);

      expect(usersService.findOne).toHaveBeenCalledWith(userId);
      expect(result).toEqual(user);
    });

    it('should return null if user not found', async () => {
      const userId = 'nonexistent';

      mockUsersService.findOne.mockRejectedValue(new Error('Not found'));

      const result = await service.validateUser(userId);

      expect(usersService.findOne).toHaveBeenCalledWith(userId);
      expect(result).toBeNull();
    });
  });

  describe('regenerateBackupCodes', () => {
    const user = {
      id: 'user-id-123',
      email: 'test@example.com',
      password: 'hashed-password',
      twoFactorEnabled: true,
      twoFactorSecret: 'encrypted-secret',
      backupCodes: ['old-hash-1'],
    };

    const encryptTwoFactorSecret = (secret: string) =>
      (
        service as unknown as {
          encryptTwoFactorSecret: (secret: string) => string;
        }
      ).encryptTwoFactorSecret(secret);

    beforeEach(() => {
      mockManager.findOne.mockReset();
      mockManager.save.mockReset();
      mockManager.findOne.mockResolvedValue(user);
      mockManager.save.mockResolvedValue(user);
      (bcrypt.hash as jest.Mock).mockResolvedValue('new-hash');
    });

    it('should regenerate backup codes when given a valid password', async () => {
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.regenerateBackupCodes('user-id-123', {
        password: 'P@ssw0rd!',
      });

      expect(result.backupCodes).toHaveLength(10);
      const hashedCodes = Array.from({ length: 10 }, () => 'new-hash');
      expect(mockManager.save).toHaveBeenCalledWith(
        expect.objectContaining({ backupCodes: hashedCodes }),
      );
    });

    it('should regenerate backup codes when given a valid TOTP code', async () => {
      mockManager.findOne.mockResolvedValue({
        ...user,
        twoFactorSecret: encryptTwoFactorSecret('JBSWY3DPEHPK3PXP'),
      });
      (otplib.verifySync as jest.Mock).mockReturnValue({ valid: true });

      const result = await service.regenerateBackupCodes('user-id-123', {
        twoFactorCode: '123456',
      });

      expect(otplib.verifySync).toHaveBeenCalled();
      expect(result.backupCodes).toHaveLength(10);
    });

    it('should throw UnauthorizedException for an invalid password', async () => {
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.regenerateBackupCodes('user-id-123', { password: 'wrong' }),
      ).rejects.toThrow(UnauthorizedException);
      expect(mockManager.save).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException for an invalid TOTP code', async () => {
      mockManager.findOne.mockResolvedValue({
        ...user,
        twoFactorSecret: encryptTwoFactorSecret('JBSWY3DPEHPK3PXP'),
      });
      (otplib.verifySync as jest.Mock).mockReturnValue({ valid: false });

      await expect(
        service.regenerateBackupCodes('user-id-123', {
          twoFactorCode: '000000',
        }),
      ).rejects.toThrow(UnauthorizedException);
      expect(mockManager.save).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when neither password nor TOTP code is provided', async () => {
      await expect(
        service.regenerateBackupCodes('user-id-123', {}),
      ).rejects.toThrow(BadRequestException);
      expect(mockManager.save).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when 2FA is not enabled', async () => {
      mockManager.findOne.mockResolvedValue({
        ...user,
        twoFactorEnabled: false,
        twoFactorSecret: null,
      });

      await expect(
        service.regenerateBackupCodes('user-id-123', { password: 'P@ssw0rd!' }),
      ).rejects.toThrow(BadRequestException);
      expect(mockManager.save).not.toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    const user = {
      id: 'user-id-123',
      email: 'test@example.com',
      roles: ['USER'],
    };

    const validTokenRecord = {
      id: 'token-row-id',
      userId: user.id,
      token: expect.any(String),
      revoked: false,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    };

    beforeEach(() => {
      mockManager.findOne.mockReset();
      mockManager.update.mockReset();
      mockManager.getRepository.mockReset();
      mockManager.getRepository.mockReturnValue({
        save: jest.fn().mockResolvedValue({}),
      });
      mockJwtService.signAsync.mockResolvedValue('new-access-token');
      mockUsersService.findOne.mockResolvedValue(user);
    });

    it('should rotate tokens on a valid refresh call', async () => {
      mockManager.findOne.mockResolvedValue(validTokenRecord);
      mockManager.update.mockResolvedValue(undefined);

      const result = await service.refresh('raw-valid-token');

      expect(result).toEqual({
        access_token: 'new-access-token',
        refresh_token: expect.any(String),
      });

      expect(mockManager.update).toHaveBeenCalledWith(
        expect.anything(),
        { id: validTokenRecord.id },
        { revoked: true },
      );
    });

    it('should return 401 for an expired refresh token', async () => {
      mockManager.findOne.mockResolvedValue({
        ...validTokenRecord,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(service.refresh('raw-expired-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should return 401 for a non-existent refresh token', async () => {
      mockManager.findOne.mockResolvedValue(null);

      await expect(service.refresh('raw-unknown-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should revoke all user sessions and return 401 on reuse of invalidated token', async () => {
      const revokedTokenRecord = {
        ...validTokenRecord,
        revoked: true,
      };
      mockManager.findOne.mockResolvedValue(revokedTokenRecord);
      mockManager.update.mockResolvedValue(undefined);

      await expect(service.refresh('raw-reused-token')).rejects.toThrow(
        UnauthorizedException,
      );

      expect(mockManager.update).toHaveBeenCalledWith(
        expect.anything(),
        { userId: user.id },
        { revoked: true },
      );
    });

    it('should return 401 when the user no longer exists', async () => {
      mockManager.findOne.mockResolvedValue(validTokenRecord);
      mockUsersService.findOne.mockRejectedValue(new Error('Not found'));

      await expect(service.refresh('raw-valid-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // disableTwoFactor — rate limiting & lockout tests  (Issue #322)
  // ──────────────────────────────────────────────────────────────────────────
  describe('disableTwoFactor', () => {
    const userId = 'user-2fa-uuid';
    const correctPassword = 'CorrectP@ss1';
    const wrongPassword = 'wrongpass';

    const makeUser = (overrides: Record<string, unknown> = {}) => ({
      id: userId,
      email: 'user@example.com',
      password: 'hashed-password',
      twoFactorEnabled: true,
      twoFactorSecret: 'encrypted-secret',
      failedLoginAttempts: 0,
      lockedUntil: null,
      ...overrides,
    });

    beforeEach(() => {
      jest.clearAllMocks();
      // Default: account is NOT locked
      mockUsersService.isAccountLocked.mockReturnValue(false);
      mockUsersService.incrementFailedLoginAttempts.mockResolvedValue(undefined);
      mockUsersService.resetFailedLoginAttempts.mockResolvedValue(undefined);
      mockUsersService.disableTwoFactor.mockResolvedValue(undefined);
    });

    it('should disable 2FA successfully when the correct password is provided', async () => {
      mockUsersService.findByIdWithSecrets.mockResolvedValue(makeUser());
      const bcrypt = require('bcrypt');
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.disableTwoFactor(userId, {
        password: correctPassword,
      });

      expect(result).toEqual({
        message: 'Two-factor authentication disabled',
        twoFactorEnabled: false,
      });
      expect(mockUsersService.incrementFailedLoginAttempts).not.toHaveBeenCalled();
      expect(mockUsersService.resetFailedLoginAttempts).toHaveBeenCalledWith(userId);
      expect(mockUsersService.disableTwoFactor).toHaveBeenCalledWith(userId);
    });

    it('should throw UnauthorizedException and increment failed attempts on wrong password', async () => {
      mockUsersService.findByIdWithSecrets.mockResolvedValue(makeUser());
      const bcrypt = require('bcrypt');
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.disableTwoFactor(userId, { password: wrongPassword }),
      ).rejects.toThrow(UnauthorizedException);

      expect(mockUsersService.incrementFailedLoginAttempts).toHaveBeenCalledWith(
        userId,
        5,
        15,
      );
      expect(mockUsersService.resetFailedLoginAttempts).not.toHaveBeenCalled();
      expect(mockUsersService.disableTwoFactor).not.toHaveBeenCalled();
    });

    it('should increment failed attempts on each repeated wrong-password submission', async () => {
      mockUsersService.findByIdWithSecrets.mockResolvedValue(makeUser());
      const bcrypt = require('bcrypt');
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      // Simulate 3 wrong-password attempts
      for (let attempt = 1; attempt <= 3; attempt++) {
        await expect(
          service.disableTwoFactor(userId, { password: wrongPassword }),
        ).rejects.toThrow(UnauthorizedException);
      }

      expect(mockUsersService.incrementFailedLoginAttempts).toHaveBeenCalledTimes(3);
      expect(mockUsersService.disableTwoFactor).not.toHaveBeenCalled();
    });

    it('should throw 423 Locked and NOT check the password when the account is already locked', async () => {
      mockUsersService.findByIdWithSecrets.mockResolvedValue(
        makeUser({ lockedUntil: new Date(Date.now() + 900_000) }),
      );
      mockUsersService.isAccountLocked.mockReturnValue(true);
      mockUsersService.getSecondsUntilUnlock.mockReturnValue(900);

      await expect(
        service.disableTwoFactor(userId, { password: wrongPassword }),
      ).rejects.toThrow(HttpException);

      // Password must never be evaluated when account is locked
      const bcrypt = require('bcrypt');
      expect(bcrypt.compare).not.toHaveBeenCalled();
      expect(mockUsersService.incrementFailedLoginAttempts).not.toHaveBeenCalled();
      expect(mockUsersService.disableTwoFactor).not.toHaveBeenCalled();
    });

    it('should return 423 with the correct seconds-until-unlock in the message', async () => {
      const secondsRemaining = 547;
      mockUsersService.findByIdWithSecrets.mockResolvedValue(
        makeUser({ lockedUntil: new Date(Date.now() + secondsRemaining * 1000) }),
      );
      mockUsersService.isAccountLocked.mockReturnValue(true);
      mockUsersService.getSecondsUntilUnlock.mockReturnValue(secondsRemaining);

      let thrownError: any;
      try {
        await service.disableTwoFactor(userId, { password: wrongPassword });
      } catch (err) {
        thrownError = err;
      }

      expect(thrownError).toBeDefined();
      const response = thrownError.getResponse();
      expect(response.statusCode).toBe(423);
      expect(response.message).toContain(String(secondsRemaining));
    });

    it('should throw BadRequestException when 2FA is not enabled', async () => {
      mockUsersService.findByIdWithSecrets.mockResolvedValue(
        makeUser({ twoFactorEnabled: false, twoFactorSecret: null }),
      );

      await expect(
        service.disableTwoFactor(userId, { password: correctPassword }),
      ).rejects.toThrow(BadRequestException);

      const bcrypt = require('bcrypt');
      expect(bcrypt.compare).not.toHaveBeenCalled();
      expect(mockUsersService.incrementFailedLoginAttempts).not.toHaveBeenCalled();
    });

    it('should reset failed attempts after a correct password following previous failures', async () => {
      mockUsersService.findByIdWithSecrets.mockResolvedValue(
        makeUser({ failedLoginAttempts: 3 }),
      );
      const bcrypt = require('bcrypt');
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await service.disableTwoFactor(userId, { password: correctPassword });

      expect(mockUsersService.resetFailedLoginAttempts).toHaveBeenCalledWith(userId);
      expect(mockUsersService.disableTwoFactor).toHaveBeenCalledWith(userId);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // verifyTwoFactor — rate limiting & lockout tests (Issue #320)
  // ──────────────────────────────────────────────────────────────────────────
  describe('verifyTwoFactor', () => {
    const userId = 'user-verify-uuid';
    const validCode = '123456';
    const invalidCode = '000000';

    const makeUser = (overrides: Record<string, unknown> = {}) => ({
      id: userId,
      email: 'user@example.com',
      twoFactorEnabled: false,
      twoFactorSecret: 'encrypted-secret',
      failedLoginAttempts: 0,
      lockedUntil: null,
      ...overrides,
    });

    const encrypt = (secret: string) =>
      (
        service as unknown as {
          encryptTwoFactorSecret: (secret: string) => string;
        }
      ).encryptTwoFactorSecret(secret);

    beforeEach(() => {
      jest.clearAllMocks();
      mockUsersService.isAccountLocked.mockReturnValue(false);
      mockUsersService.incrementFailedLoginAttempts.mockResolvedValue(undefined);
      mockUsersService.resetFailedLoginAttempts.mockResolvedValue(undefined);
      mockUsersService.enableTwoFactor.mockResolvedValue(undefined);
      // default mock for findByIdWithSecrets — will be overridden per test
      mockUsersService.findByIdWithSecrets.mockResolvedValue(
        makeUser({ twoFactorSecret: encrypt('JBSWY3DPEHPK3PXP') }),
      );
    });

    it('should verify TOTP successfully and reset lockout counter', async () => {
      const otplib = require('otplib');
      (otplib.verifySync as jest.Mock).mockReturnValue({ valid: true });
      mockUsersService.findByIdWithSecrets.mockResolvedValue(
        makeUser({ twoFactorSecret: encrypt('JBSWY3DPEHPK3PXP') }),
      );

      const result = await service.verifyTwoFactor(userId, { code: validCode });

      expect(result).toEqual({
        message: 'Two-factor authentication enabled',
        twoFactorEnabled: true,
      });
      expect(mockUsersService.resetFailedLoginAttempts).toHaveBeenCalledWith(userId);
      expect(mockUsersService.enableTwoFactor).toHaveBeenCalledWith(userId);
      expect(mockUsersService.incrementFailedLoginAttempts).not.toHaveBeenCalled();
    });

    it('should throw Unauthorized and increment counter on invalid TOTP', async () => {
      const otplib = require('otplib');
      (otplib.verifySync as jest.Mock).mockReturnValue({ valid: false });

      await expect(
        service.verifyTwoFactor(userId, { code: invalidCode }),
      ).rejects.toThrow(UnauthorizedException);

      expect(mockUsersService.incrementFailedLoginAttempts).toHaveBeenCalledWith(
        userId,
        5,
        15,
      );
      expect(mockUsersService.enableTwoFactor).not.toHaveBeenCalled();
    });

    it('should increment failed attempts on each repeated invalid code', async () => {
      const otplib = require('otplib');
      (otplib.verifySync as jest.Mock).mockReturnValue({ valid: false });

      for (let i = 0; i < 3; i++) {
        await expect(
          service.verifyTwoFactor(userId, { code: invalidCode }),
        ).rejects.toThrow(UnauthorizedException);
      }
      expect(mockUsersService.incrementFailedLoginAttempts).toHaveBeenCalledTimes(3);
    });

    it('should throw 423 Locked and NOT verify TOTP when account is locked', async () => {
      mockUsersService.findByIdWithSecrets.mockResolvedValue(
        makeUser({
          twoFactorSecret: encrypt('JBSWY3DPEHPK3PXP'),
          lockedUntil: new Date(Date.now() + 900_000),
        }),
      );
      mockUsersService.isAccountLocked.mockReturnValue(true);
      mockUsersService.getSecondsUntilUnlock.mockReturnValue(900);

      await expect(
        service.verifyTwoFactor(userId, { code: validCode }),
      ).rejects.toThrow(HttpException);

      const otplib = require('otplib');
      expect(otplib.verifySync).not.toHaveBeenCalled();
      expect(mockUsersService.incrementFailedLoginAttempts).not.toHaveBeenCalled();
    });

    it('should throw BadRequest when 2FA secret not set up', async () => {
      mockUsersService.findByIdWithSecrets.mockResolvedValue(
        makeUser({ twoFactorSecret: null }),
      );
      await expect(
        service.verifyTwoFactor(userId, { code: validCode }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
