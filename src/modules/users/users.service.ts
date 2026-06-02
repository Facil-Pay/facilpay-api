import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserRole } from '../../common/constants/roles';
import * as bcrypt from 'bcrypt';
import { AppLogger } from '../logger/logger.service';
import { Logger } from 'pino';

@Injectable()
export class UsersService {
  private readonly logger: Logger;

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    appLogger: AppLogger,
  ) {
    this.logger = appLogger.child({ module: UsersService.name });
  }

  async create(
    createUserDto: CreateUserDto,
  ): Promise<Omit<User, 'password' | 'twoFactorSecret'>> {
    const hashedPassword = await bcrypt.hash(createUserDto.password, 10);

    const user = this.userRepository.create({
      email: createUserDto.email,
      password: hashedPassword,
      roles: [UserRole.USER],
      isEmailVerified: false,
      isActive: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
    });

    const savedUser = await this.userRepository.save(user);
    const { password, ...result } = savedUser;
    this.logger.info(
      { userId: result.id, email: result.email },
      'User created',
    );
    return result;
  }

  async findAll(params?: {
    page?: number;
    limit?: number;
    sortBy?: string;
    search?: string;
  }): Promise<import('../../common/interfaces').PaginatedResult<Omit<User, 'password'>>> {
    const query = this.userRepository.createQueryBuilder('user')
      .where('user.deletedAt IS NULL');

    // Filtering by email (partial match)
    if (params?.search) {
      query.andWhere('user.email ILIKE :search', {
        search: `%${params.search}%`,
      });
    }

    // Sorting
    if (params?.sortBy && ['email', 'createdAt', 'updatedAt'].includes(params.sortBy)) {
      query.orderBy(`user.${params.sortBy}`, 'ASC');
    }

    // Pagination
    const page = Math.max(1, params?.page ?? 1);
    const limit = Math.min(Math.max(1, params?.limit ?? 20), 100);
    const skip = (page - 1) * limit;

    const [users, total] = await query
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    const data = users.map(({ password, ...rest }) => rest);
    return { data, total, page, limit };
  }

  async findOne(id: string): Promise<Omit<User, 'password'>> {
    const user = await this.userRepository.findOne({
      where: { id, deletedAt: null },
    });
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    return this.sanitizeUser(user);
  }

  async findByEmail(email: string): Promise<User | undefined> {
    return await this.userRepository.findOne({
      where: { email, deletedAt: null },
    });
  }

  async findByIdWithSecrets(id: string): Promise<User> {
    const user = this.users.find((user) => user.id === id && !user.deletedAt);
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    return user;
  }

  async update(
    id: string,
    updateUserDto: UpdateUserDto,
  ): Promise<Omit<User, 'password'>> {
    const user = await this.userRepository.findOne({
      where: { id, deletedAt: null },
    });
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    const updates: Partial<User> = { ...updateUserDto };
    if (updateUserDto.password) {
      updates.password = await bcrypt.hash(updateUserDto.password, 10);
    }

    Object.assign(user, updates);
    user.updatedAt = new Date();

    const updatedUser = await this.userRepository.save(user);
    const { password, ...result } = updatedUser;

    const updatedFields = Object.keys(updateUserDto).filter(
      (key) => key !== 'password',
    );
    if (updatedFields.length > 0) {
      this.logger.info({ userId: result.id, updatedFields }, 'User updated');
    }
    return result;
  }

  async softDelete(id: string): Promise<void> {
    const user = await this.userRepository.findOne({
      where: { id, deletedAt: null },
    });
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    user.deletedAt = new Date();
    user.isActive = false;
    user.updatedAt = new Date();
    await this.userRepository.save(user);
    this.logger.info({ userId: id }, 'User soft deleted');
  }

  async remove(id: string): Promise<void> {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    await this.userRepository.remove(user);
    this.logger.info({ userId: id }, 'User removed');
  }

  async restore(id: string): Promise<Omit<User, 'password'>> {
    const user = await this.userRepository.findOne({
      where: { id, deletedAt: null },
    });
    if (!user) {
      throw new NotFoundException(`Deleted user with ID ${id} not found`);
    }
    user.deletedAt = null;
    user.isActive = true;
    user.updatedAt = new Date();
    const savedUser = await this.userRepository.save(user);
    const { password, ...result } = savedUser;
    this.logger.info({ userId: id }, 'User restored');
    return result;
  }

  async verifyEmail(id: string): Promise<void> {
    const user = await this.userRepository.findOne({
      where: { id, deletedAt: null },
    });
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    user.isEmailVerified = true;
    user.updatedAt = new Date();
    await this.userRepository.save(user);
    this.logger.info({ userId: id }, 'User email verified');
  }

  async updatePassword(id: string, hashedPassword: string): Promise<void> {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    user.password = hashedPassword;
    user.updatedAt = new Date();
    await this.userRepository.save(user);
    this.logger.info({ userId: id }, 'User password updated');
  }

  /**
   * Increment failed login attempts and lock account if threshold reached
   */
  async incrementFailedLoginAttempts(
    userId: string,
    maxAttempts: number = 5,
    lockDurationMinutes: number = 15,
  ): Promise<number> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
    user.updatedAt = new Date();

    // Lock account if max attempts reached
    if (user.failedLoginAttempts >= maxAttempts) {
      user.lockedUntil = new Date(Date.now() + lockDurationMinutes * 60 * 1000);
      this.logger.warn(
        { userId, failedAttempts: user.failedLoginAttempts },
        'Account locked due to failed login attempts',
      );
    } else {
      this.logger.debug(
        { userId, failedAttempts: user.failedLoginAttempts },
        'Failed login attempt recorded',
      );
    }

    await this.userRepository.save(user);
    return user.failedLoginAttempts;
  }

  /**
   * Reset failed login attempts on successful login
   */
  async resetFailedLoginAttempts(userId: string): Promise<void> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    if (user.failedLoginAttempts > 0 || user.lockedUntil) {
      user.failedLoginAttempts = 0;
      user.lockedUntil = null;
      user.updatedAt = new Date();
      await this.userRepository.save(user);
      this.logger.info(
        { userId },
        'Failed login attempts reset on successful login',
      );
    }
  }

  /**
   * Check if account is locked
   */
  isAccountLocked(user: User): boolean {
    if (!user.lockedUntil) {
      return false;
    }

    const now = new Date();
    const isLocked = new Date(user.lockedUntil) > now;

    // Clear lock if expired
    if (!isLocked && user.lockedUntil) {
      user.lockedUntil = null;
      user.failedLoginAttempts = 0;
      this.userRepository.save(user);
    }

    return isLocked;
  }

  /**
   * Get seconds remaining until account is unlocked
   */
  getSecondsUntilUnlock(user: User): number {
    if (!user.lockedUntil) {
      return 0;
    }

    const now = new Date();
    const unlockTime = new Date(user.lockedUntil);
    const secondsRemaining = Math.ceil((unlockTime.getTime() - now.getTime()) / 1000);

    return Math.max(0, secondsRemaining);
  }

  /**
   * Manually unlock an account (admin only)
   */
  async unlockAccount(userId: string): Promise<Omit<User, 'password'>> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    user.failedLoginAttempts = 0;
    user.lockedUntil = null;
    user.updatedAt = new Date();

    const savedUser = await this.userRepository.save(user);
    this.logger.info({ userId }, 'Account unlocked by admin');

    const { password, ...result } = savedUser;
    return result;
  }
}
