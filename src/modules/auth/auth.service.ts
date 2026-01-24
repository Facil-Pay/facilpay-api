import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { User } from '../users/user.entity';
import { RegisterDto } from '../users/dto/register.dto';
import { LoginDto } from '../users/dto/login.dto';
import { UsersService } from '../users/users.service';

@Injectable()
export class AuthService {

  constructor(
    private usersService: UsersService,
    private jwtService: JwtService
  ) { }

  async register(registerDto: RegisterDto): Promise<{ message: string; user: Omit<User, 'password'> }> {
    const existingUser = await this.usersService.findByEmail(registerDto.email);
    if (existingUser) {
      throw new UnauthorizedException('User already exists');
    }

    const user = await this.usersService.create(registerDto);

    return {
      message: 'User registered successfully',
      user: user,
    };
  }

  async login(loginDto: LoginDto): Promise<{ access_token: string; user: Omit<User, 'password'> }> {
    const user = await this.usersService.findByEmail(loginDto.email);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(loginDto.password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload = { sub: user.id, email: user.email };
    const access_token = this.jwtService.sign(payload);

    const { password, ...userWithoutPassword } = user;
    return {
      access_token,
      user: userWithoutPassword,
    };
  }

  async validateUser(userId: string): Promise<Omit<User, 'password'> | null> {
    const user = await this.usersService.findOne(userId).catch(() => null);
    if (!user) {
      return null;
    }
    return user;
  }
}
