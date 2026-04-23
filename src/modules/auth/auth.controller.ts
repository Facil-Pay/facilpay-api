import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from '../users/dto/register.dto';
import { LoginDto } from '../users/dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { VerifyEmailQueryDto } from './dto/verify-email-query.dto';
import { AuthThrottle } from '../throttler/throttler.decorator';
import { Public } from './decorators/public.decorator';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
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
      'Creates a new user account. Sends a verification email. Rate limited to 5 requests per 15 minutes.',
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
    description: 'User registered. Verification email sent.',
    schema: {
      example: {
        message:
          'User registered successfully. Please check your email to verify your account.',
        user: {
          id: 'abc123',
          email: 'jane.doe@example.com',
          roles: ['USER'],
          isEmailVerified: false,
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
      'Authenticates a verified user and returns JWT access token, refresh token, and user. Rate limited to 5 requests per 15 minutes.',
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
        access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        refresh_token: '550e8400-e29b-41d4-a716-446655440000',
        user: {
          id: 'abc123',
          email: 'jane.doe@example.com',
          roles: ['USER'],
          isEmailVerified: true,
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
  @ApiForbiddenResponse({
    description: 'Email not verified.',
    schema: {
      example: {
        statusCode: 403,
        message:
          'Email address not verified. Please check your inbox and verify your email before logging in.',
        error: 'Forbidden',
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

  @Public()
  @Get('verify-email')
  @ApiOperation({
    summary: 'Verify email address',
    description:
      "Confirms a user's email using the signed JWT token from the verification email. Token expires after 24 hours.",
  })
  @ApiQuery({
    name: 'token',
    description: 'Signed JWT verification token from the registration email',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  @ApiOkResponse({
    description: 'Email verified successfully.',
    schema: {
      example: { message: 'Email verified successfully. You can now log in.' },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid or expired token.',
    schema: {
      example: {
        statusCode: 401,
        message: 'Invalid or expired verification token',
        error: 'Unauthorized',
      },
    },
  })
  async verifyEmail(@Query() query: VerifyEmailQueryDto) {
    return this.authService.verifyEmail(query.token);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Refresh access token',
    description:
      'Issues a new JWT access token using a valid, non-expired, non-revoked refresh token.',
  })
  @ApiBody({ type: RefreshTokenDto })
  @ApiOkResponse({
    description: 'New access token issued.',
    schema: {
      example: { access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid, expired, or revoked refresh token.',
    schema: {
      example: {
        statusCode: 401,
        message: 'Invalid or expired refresh token',
        error: 'Unauthorized',
      },
    },
  })
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refresh_token);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Logout',
    description: 'Revokes the provided refresh token immediately.',
  })
  @ApiBody({ type: RefreshTokenDto })
  @ApiNoContentResponse({ description: 'Refresh token revoked.' })
  async logout(@Body() dto: RefreshTokenDto) {
    await this.authService.logout(dto.refresh_token);
  }
}
