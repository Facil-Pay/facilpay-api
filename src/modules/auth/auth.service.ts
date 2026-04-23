import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash, randomUUID } from 'crypto';
import * as bcrypt from 'bcrypt';
import { User } from '../users/user.entity';
import { RegisterDto } from '../users/dto/register.dto';
import { LoginDto } from '../users/dto/login.dto';
import { UsersService } from '../users/users.service';
import { AppLogger } from '../logger/logger.service';
import { Logger } from 'pino';
import { RefreshToken } from './entities/refresh-token.entity';
import { MailService } from './mail/mail.service';

@Injectable()
export class AuthService {
  private readonly logger: Logger;

  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private mailService: MailService,
    @InjectRepository(RefreshToken)
    private refreshTokenRepository: Repository<RefreshToken>,
    appLogger: AppLogger,
  ) {
    this.logger = appLogger.child({ module: AuthService.name });
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
    access_token: string;
    refresh_token: string;
    user: Omit<User, 'password'>;
  }> {
    const user = await this.usersService.findByEmail(loginDto.email);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(
      loginDto.password,
      user.password,
    );
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isEmailVerified) {
      throw new ForbiddenException(
        'Email address not verified. Please check your inbox and verify your email before logging in.',
      );
    }

    const payload = { sub: user.id, email: user.email };
    const [access_token, refresh_token] = await Promise.all([
      this.jwtService.signAsync(payload),
      this.generateRefreshToken(user.id),
    ]);

    const { password, ...userWithoutPassword } = user;
    this.logger.info(
      { userId: user.id, email: user.email },
      'User login successful',
    );
    return { access_token, refresh_token, user: userWithoutPassword };
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

  async refresh(rawToken: string): Promise<{ access_token: string }> {
    const hashedToken = createHash('sha256').update(rawToken).digest('hex');
    const tokenRecord = await this.refreshTokenRepository.findOne({
      where: { token: hashedToken },
    });

    if (
      !tokenRecord ||
      tokenRecord.revoked ||
      tokenRecord.expiresAt < new Date()
    ) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await this.usersService
      .findOne(tokenRecord.userId)
      .catch(() => null);
    if (!user) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const payload = { sub: user.id, email: user.email };
    const access_token = await this.jwtService.signAsync(payload);
    return { access_token };
  }

  async logout(rawToken: string): Promise<void> {
    const hashedToken = createHash('sha256').update(rawToken).digest('hex');
    await this.refreshTokenRepository.update(
      { token: hashedToken },
      { revoked: true },
    );
  }

  async validateUser(userId: string): Promise<Omit<User, 'password'> | null> {
    const user = await this.usersService.findOne(userId).catch(() => null);
    if (!user) {
      return null;
    }
    return user;
  }

  private async generateRefreshToken(userId: string): Promise<string> {
    const rawToken = randomUUID();
    const hashedToken = createHash('sha256').update(rawToken).digest('hex');

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    await this.refreshTokenRepository.save({
      token: hashedToken,
      userId,
      expiresAt,
      revoked: false,
    });

    return rawToken;
  }
}
