import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from '../users/dto/register.dto';
import { LoginDto } from '../users/dto/login.dto';
import { AuthThrottle } from '../throttler/throttler.decorator';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @AuthThrottle()
  @Post('register')
  @ApiOperation({
    summary: 'Register a new user',
    description:
      'Creates a new user account. Password is hashed before storage. Returns the created user (without password). Rate limited to 5 requests per 15 minutes.',
  })
  @ApiBody({
    type: RegisterDto,
    examples: {
      basic: {
        summary: 'Register with email + password',
        value: { email: 'jane.doe@example.com', password: 'P@ssw0rd!' },
      },
    },
  })
  @ApiCreatedResponse({
    description: 'User registered successfully.',
    schema: {
      example: {
        message: 'User registered successfully',
        user: {
          id: 'abc123',
          email: 'jane.doe@example.com',
          roles: ['USER'],
          createdAt: '2026-01-26T10:00:00.000Z',
          updatedAt: '2026-01-26T10:00:00.000Z',
        },
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'User already exists.',
    schema: {
      example: {
        statusCode: 401,
        message: 'User already exists',
        error: 'Unauthorized',
      },
    },
  })
  @ApiTooManyRequestsResponse({
    description: 'Too many requests. Rate limit exceeded.',
    schema: {
      example: {
        statusCode: 429,
        message: 'ThrottlerException: Too Many Requests',
      },
    },
  })
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @AuthThrottle()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Login',
    description:
      'Authenticates a user and returns a JWT access token and the user (without password). Rate limited to 5 requests per 15 minutes.',
  })
  @ApiBody({
    type: LoginDto,
    examples: {
      basic: {
        summary: 'Login with email + password',
        value: { email: 'jane.doe@example.com', password: 'P@ssw0rd!' },
      },
    },
  })
  @ApiOkResponse({
    description: 'Login successful.',
    schema: {
      example: {
        access_token:
          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhYmMxMjMiLCJlbWFpbCI6ImphbmUuZG9lQGV4YW1wbGUuY29tIiwiaWF0IjoxNzA2MjYwMDAwLCJleHAiOjE3MDYzNDY0MDB9.abc123signature',
        user: {
          id: 'abc123',
          email: 'jane.doe@example.com',
          roles: ['USER'],
          createdAt: '2026-01-26T10:00:00.000Z',
          updatedAt: '2026-01-26T10:00:00.000Z',
        },
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid credentials.',
    schema: {
      example: {
        statusCode: 401,
        message: 'Invalid credentials',
        error: 'Unauthorized',
      },
    },
  })
  @ApiTooManyRequestsResponse({
    description: 'Too many requests. Rate limit exceeded.',
    schema: {
      example: {
        statusCode: 429,
        message: 'ThrottlerException: Too Many Requests',
      },
    },
  })
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }
}
