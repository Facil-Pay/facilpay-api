import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import { MailService } from './mail/mail.service';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RefreshToken } from './entities/refresh-token.entity';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { AppLogger } from '../logger/logger.service';
import { BadRequestException } from '@nestjs/common';

describe('AuthService - Password Reset', () => {
  let service: AuthService;
  let usersService: UsersService;
  let mailService: MailService;
  let passwordResetTokenRepository: any;
  let refreshTokenRepository: any;

  beforeEach(async () => {
    passwordResetTokenRepository = {
      save: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
    };

    refreshTokenRepository = {
      save: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UsersService,
          useValue: {
            findByEmail: jest.fn(),
            findOne: jest.fn(),
            updatePassword: jest.fn(),
          },
        },
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn(),
            verify: jest.fn(),
          },
        },
        {
          provide: MailService,
          useValue: {
            sendPasswordResetEmail: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key) => {
              if (key === 'PASSWORD_RESET_EXPIRES_IN') return '15m';
              if (key === 'JWT_EXPIRES_IN') return '24h';
              return null;
            }),
          },
        },
        {
          provide: getRepositoryToken(RefreshToken),
          useValue: refreshTokenRepository,
        },
        {
          provide: getRepositoryToken(PasswordResetToken),
          useValue: passwordResetTokenRepository,
        },
        {
          provide: AppLogger,
          useValue: {
            child: jest.fn().mockReturnValue({
              info: jest.fn(),
              error: jest.fn(),
              warn: jest.fn(),
            }),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    usersService = module.get<UsersService>(UsersService);
    mailService = module.get<MailService>(MailService);
  });

  describe('forgotPassword', () => {
    it('should return success message for non-existent email', async () => {
      jest.spyOn(usersService, 'findByEmail').mockResolvedValue(undefined);

      const result = await service.forgotPassword({
        email: 'nonexistent@example.com',
      });

      expect(result.message).toContain(
        'If an account with that email exists',
      );
      expect(passwordResetTokenRepository.save).not.toHaveBeenCalled();
      expect(mailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('should generate token and send email for existing user', async () => {
      const user = {
        id: 'user-1',
        email: 'user@example.com',
        password: 'hashed',
      };

      jest.spyOn(usersService, 'findByEmail').mockResolvedValue(user as any);
      passwordResetTokenRepository.save.mockResolvedValue({});
      jest.spyOn(mailService, 'sendPasswordResetEmail').mockResolvedValue();

      const result = await service.forgotPassword({ email: user.email });

      expect(result.message).toContain(
        'If an account with that email exists',
      );
      expect(passwordResetTokenRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: user.id,
          tokenHash: expect.any(String),
          expiresAt: expect.any(Date),
          used: false,
        }),
      );
      expect(mailService.sendPasswordResetEmail).toHaveBeenCalledWith(
        user.email,
        expect.any(String),
      );
    });
  });

  describe('resetPassword', () => {
    it('should throw BadRequestException for invalid token', async () => {
      passwordResetTokenRepository.findOne.mockResolvedValue(null);

      await expect(
        service.resetPassword({
          token: 'invalid-token',
          email: 'user@example.com',
          newPassword: 'NewPassword123',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for expired token', async () => {
      const expiredToken = {
        tokenHash: 'hash',
        userId: 'user-1',
        expiresAt: new Date(Date.now() - 1000),
        used: false,
      };

      passwordResetTokenRepository.findOne.mockResolvedValue(expiredToken);

      await expect(
        service.resetPassword({
          token: 'expired-token',
          email: 'user@example.com',
          newPassword: 'NewPassword123',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for already used token', async () => {
      const usedToken = {
        tokenHash: 'hash',
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 3600000),
        used: true,
      };

      passwordResetTokenRepository.findOne.mockResolvedValue(usedToken);

      await expect(
        service.resetPassword({
          token: 'used-token',
          email: 'user@example.com',
          newPassword: 'NewPassword123',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reset password and invalidate sessions', async () => {
      const validToken = {
        tokenHash: 'hash',
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 3600000),
        used: false,
      };

      const user = {
        id: 'user-1',
        email: 'user@example.com',
        password: 'old-hash',
      };

      passwordResetTokenRepository.findOne.mockResolvedValue(validToken);
      jest.spyOn(usersService, 'findOne').mockResolvedValue(user as any);
      jest.spyOn(usersService, 'updatePassword').mockResolvedValue();
      passwordResetTokenRepository.update.mockResolvedValue({});
      refreshTokenRepository.update.mockResolvedValue({});

      const result = await service.resetPassword({
        token: 'valid-token',
        email: user.email,
        newPassword: 'NewPassword123',
      });

      expect(result.message).toContain('Password reset successful');
      expect(usersService.updatePassword).toHaveBeenCalledWith(
        user.id,
        expect.any(String),
      );
      expect(passwordResetTokenRepository.update).toHaveBeenCalledWith(
        { tokenHash: expect.any(String) },
        { used: true },
      );
      expect(refreshTokenRepository.update).toHaveBeenCalledWith(
        { userId: user.id },
        { revoked: true },
      );
    });

    it('should throw BadRequestException for email mismatch', async () => {
      const validToken = {
        tokenHash: 'hash',
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 3600000),
        used: false,
      };

      const user = {
        id: 'user-1',
        email: 'user@example.com',
        password: 'hash',
      };

      passwordResetTokenRepository.findOne.mockResolvedValue(validToken);
      jest.spyOn(usersService, 'findOne').mockResolvedValue(user as any);

      await expect(
        service.resetPassword({
          token: 'valid-token',
          email: 'different@example.com',
          newPassword: 'NewPassword123',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
