import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Param,
  HttpCode,
  HttpStatus,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { RegisterDto } from '../users/dto/register.dto';
import { LoginDto } from '../users/dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailQueryDto } from './dto/verify-email-query.dto';
import { TwoFactorCodeDto } from './dto/two-factor-code.dto';
import { AuthThrottle } from '../throttler/throttler.decorator';
import { Public } from './decorators/public.decorator';
import { RolesGuard } from './roles.guard';
import { Roles } from './decorators/roles.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { User } from '../users/user.entity';
import {
  ApiBody,
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
  ApiBadRequestResponse,
  ApiParam,
  ApiResponse,
} from '@nestjs/swagger';

@ApiTags('auth')
@Controller('v1/auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private usersService: UsersService,
  ) { }
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
      'Authenticates a verified user and returns JWT access token, refresh token, and user. Implements account lockout after 5 failed attempts (15 minutes). Rate limited to 5 requests per 15 minutes.',
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
  @ApiResponse({
    status: 423,
    description: 'Account locked due to too many failed login attempts.',
    schema: {
      example: {
        statusCode: 423,
        message: 'Account is locked. Please try again in 900 seconds.',
        error: 'Locked',
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
    description: 'Email not verified or account deleted.',
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
  async login(
    @Body() loginDto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(loginDto);
    if (result['2fa_required']) {
      res.status(HttpStatus.ACCEPTED);
    }
    return result;
  }

  @Post('2fa/enable')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Start two-factor authentication setup',
    description:
      'Generates an encrypted TOTP secret for the current user and returns an otpauth URI that can be rendered as a QR code.',
  })
  @ApiOkResponse({
    description: 'Two-factor setup secret generated.',
    schema: {
      example: {
        secret: 'JBSWY3DPEHPK3PXP',
        qrCodeUri:
          'otpauth://totp/FacilPay:jane.doe%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=FacilPay&algorithm=SHA1&digits=6&period=30',
        otpauthUri:
          'otpauth://totp/FacilPay:jane.doe%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=FacilPay&algorithm=SHA1&digits=6&period=30',
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Missing or invalid bearer token.',
  })
  async enableTwoFactor(@CurrentUser() user: User) {
    return this.authService.enableTwoFactor(user.id);
  }

  @Post('2fa/verify')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Verify and activate two-factor authentication',
    description:
      'Checks the current TOTP code from the authenticator app and turns 2FA on when valid.',
  })
  @ApiBody({ type: TwoFactorCodeDto })
  @ApiOkResponse({
    description: 'Two-factor authentication enabled.',
    schema: {
      example: {
        message: 'Two-factor authentication enabled',
        twoFactorEnabled: true,
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid TOTP code.',
    schema: {
      example: {
        statusCode: 401,
        message: 'Invalid two-factor code',
        error: 'Unauthorized',
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Two-factor setup has not been started.',
  })
  async verifyTwoFactor(
    @CurrentUser() user: User,
    @Body() dto: TwoFactorCodeDto,
  ) {
    return this.authService.verifyTwoFactor(user.id, dto);
  }

  @Post('2fa/disable')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Disable two-factor authentication',
    description:
      'Requires the current TOTP code and then removes the stored encrypted secret.',
  })
  @ApiBody({ type: TwoFactorCodeDto })
  @ApiOkResponse({
    description: 'Two-factor authentication disabled.',
    schema: {
      example: {
        message: 'Two-factor authentication disabled',
        twoFactorEnabled: false,
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid TOTP code.',
    schema: {
      example: {
        statusCode: 401,
        message: 'Invalid two-factor code',
        error: 'Unauthorized',
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Two-factor authentication is not enabled.',
  })
  async disableTwoFactor(
    @CurrentUser() user: User,
    @Body() dto: TwoFactorCodeDto,
  ) {
    return this.authService.disableTwoFactor(user.id, dto);
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
    summary: 'Refresh token pair',
    description:
      'Issues a new access token and a new refresh token. The presented refresh token is immediately invalidated (token rotation). ' +
      'Reusing an already-invalidated refresh token returns 401 and revokes all active sessions for that user.',
  })
  @ApiBody({ type: RefreshTokenDto })
  @ApiOkResponse({
    description: 'New token pair issued. Old refresh token is invalidated.',
    schema: {
      example: {
        access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        refresh_token: '550e8400-e29b-41d4-a716-446655440000',
      },
    },
  })
  @ApiUnauthorizedResponse({
    description:
      'Invalid, expired, or already-used refresh token. If the token was previously rotated, all sessions for that user are revoked.',
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

  @AuthThrottle()
  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Request password reset',
    description:
      'Sends a password reset email with a time-limited token (1 hour). Returns 200 even if email does not exist to prevent user enumeration. Rate limited to 5 requests per 15 minutes.',
  })
  @ApiBody({ type: ForgotPasswordDto })
  @ApiOkResponse({
    description: 'Password reset email sent (if account exists).',
    schema: {
      example: {
        message:
          'If an account with that email exists, a password reset link has been sent.',
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
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @AuthThrottle()
  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reset password',
    description:
      'Resets the password using a valid token from the reset email. Invalidates all existing refresh tokens. Rate limited to 5 requests per 15 minutes.',
  })
  @ApiBody({ type: ResetPasswordDto })
  @ApiOkResponse({
    description: 'Password reset successful. All sessions invalidated.',
    schema: {
      example: {
        message: 'Password reset successful. Please log in again.',
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Invalid, expired, or already-used token.',
    schema: {
      example: {
        statusCode: 400,
        message: 'Invalid or expired password reset token',
        error: 'Bad Request',
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
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Post('unlock/:userId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Unlock account (Admin only)',
    description:
      'Manually unlocks a user account and resets failed login attempt counter. Requires ADMIN role.',
  })
  @ApiParam({
    name: 'userId',
    description: 'User ID to unlock',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @ApiOkResponse({
    description: 'Account unlocked successfully.',
    schema: {
      example: {
        id: 'abc123',
        email: 'user@example.com',
        roles: ['USER'],
        isEmailVerified: true,
        isActive: true,
        failedLoginAttempts: 0,
        lockedUntil: null,
        createdAt: '2026-01-26T10:00:00.000Z',
        updatedAt: '2026-01-26T10:00:00.000Z',
      },
    },
  })
  @ApiForbiddenResponse({
    description: 'User does not have ADMIN role.',
    schema: {
      example: {
        statusCode: 403,
        message: 'Forbidden resource',
        error: 'Forbidden',
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'User not found.',
    schema: {
      example: {
        statusCode: 404,
        message: 'User with ID abc123 not found',
        error: 'Not Found',
      },
    },
  })
  async unlockAccount(@Param('userId') userId: string) {
    return this.usersService.unlockAccount(userId);
  }
}
