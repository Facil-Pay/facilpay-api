import { Injectable, NotFoundException } from '@nestjs/common';
import { User } from './user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import * as bcrypt from 'bcrypt';
import { AppLogger } from '../logger/logger.service';
import { Logger } from 'pino';

@Injectable()
export class UsersService {
  private users: User[] = [];
  private readonly logger: Logger;

  constructor(appLogger: AppLogger) {
    this.logger = appLogger.child({ module: UsersService.name });
  }

  async create(createUserDto: CreateUserDto): Promise<Omit<User, 'password'>> {
    const hashedPassword = await bcrypt.hash(createUserDto.password, 10);

    const user: User = {
      id: Math.random().toString(36).substring(7),
      email: createUserDto.email,
      password: hashedPassword,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.users.push(user);
    const { password, ...result } = user;
    this.logger.info(
      { userId: result.id, email: result.email },
      'User created',
    );
    return result;
  }

  async findAll(): Promise<Omit<User, 'password'>[]> {
    return this.users.map((user) => {
      const { password, ...result } = user;
      return result;
    });
  }

  async findOne(id: string): Promise<Omit<User, 'password'>> {
    const user = this.users.find((user) => user.id === id);
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    const { password, ...result } = user;
    return result;
  }

  async findByEmail(email: string): Promise<User | undefined> {
    return this.users.find((user) => user.email === email);
  }

  async update(
    id: string,
    updateUserDto: UpdateUserDto,
  ): Promise<Omit<User, 'password'>> {
    const userIndex = this.users.findIndex((user) => user.id === id);
    if (userIndex === -1) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    const updates: Partial<User> = { ...updateUserDto };
    if (updateUserDto.password) {
      updates.password = await bcrypt.hash(updateUserDto.password, 10);
    }

    const updatedUser = {
      ...this.users[userIndex],
      ...updates,
      updatedAt: new Date(),
    };

    this.users[userIndex] = updatedUser;

    const { password, ...result } = updatedUser;
    const updatedFields = Object.keys(updateUserDto).filter(
      (key) => key !== 'password',
    );
    if (updatedFields.length > 0) {
      this.logger.info({ userId: result.id, updatedFields }, 'User updated');
    }
    return result;
  }

  async remove(id: string): Promise<void> {
    const userIndex = this.users.findIndex((user) => user.id === id);
    if (userIndex === -1) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    this.users.splice(userIndex, 1);
    this.logger.info({ userId: id }, 'User removed');
  }
}
