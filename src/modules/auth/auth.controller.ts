import {
  BadRequestException,
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Query,
  Param,
  HttpCode,
  HttpStatus,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { RequestMagicLinkDto, VerifyMagicLinkDto } from './dto/magic-link.dto';
import { extractClientIp } from '../merchants/ip-utils';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { RegisterDto } from '../users/dto/register.dto';
import { LoginDto } from '../users/dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { VerifyEmailQueryDto } from './dto/verify-email-query.dto';
import { TwoFactorCodeDto } from './dto/two-factor-code.dto';
import { DisableTwoFactorDto } from './dto/disable-two-factor.dto';
import { RegenerateBackupCodesDto } from './dto/regenerate-backup-codes.dto';
import { StepUpDto, StepUpConfirmationDto } from './dto/step-up.dto';
import { AuthThrottle } from '../throttler/throttler.decorator';
import { Public } from './decorators/public.decorator';
import { RolesGuard } from './roles.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { Roles } from './decorators/roles.decorator';
import { Permissions } from './decorators/permissions.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { User } from '../users/user.entity';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import {
  RenameWebAuthnCredentialDto,
  WebAuthnAuthenticationOptionsDto,
  WebAuthnAuthenticationVerifyDto,
  WebAuthnRegistrationVerifyDto,
} from './dto/webauthn.dto';
import { WebAuthnService } from './webauthn.service';
import { LoginAlertsService } from './login-alerts.service';
import { LoginAlertPreferenceDto } from './dto/login-alert-preference.dto';
import { AssignRoleDto } from './dto/assign-role.dto';
import { GoogleAuthorizeDto, GoogleCallbackDto } from './dto/google.dto';
import { Sep10ChallengeDto, Sep10TokenDto } from './dto/sep10.dto';
import { GoogleOidcService } from './google-oidc.service';
import { Sep10Service } from './sep10.service';
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
    private readonly webAuthnService: WebAuthnService,
    private readonly loginAlertsService: LoginAlertsService,
    private readonly googleOidcService: GoogleOidcService,
    private readonly sep10Service: Sep10Service,
  ) {}

  @AuthThrottle()
  @Public()
  @Post('magic-link')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Email a single-use sign-in link valid for 15 minutes' })
  requestMagicLink(@Body() dto: RequestMagicLinkDto, @Req() req: Request) {
    return this.authService.requestMagicLink(dto.email, req.ip);
  }

  @AuthThrottle()
  @Public()
  @Post('magic-link/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Redeem a sign-in link; requires a second factor when configured' })
  verifyMagicLink(@Body() dto: VerifyMagicLinkDto, @Req() req: Request) {
    return this.authService.verifyMagicLink(dto.token, req.ip, req.headers['user-agent'], dto.deviceId, dto.twoFactorCode);
  }

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
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(
      loginDto,
      (req as any)?.ip,
      (req as any)?.headers?.['user-agent'] as string | undefined,
    );
    if (result['2fa_required']) {
      (res as any)?.status?.(HttpStatus.ACCEPTED);
    }
    return result;
  }

  @AuthThrottle()
  @Post('webauthn/registration/options')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Create passkey registration options' })
  @ApiOkResponse({ description: 'Registration options and a short-lived challenge token.' })
  async getWebAuthnRegistrationOptions(@CurrentUser() user: User) {
    return this.webAuthnService.registrationOptions(user.id);
  }

  @AuthThrottle()
  @Post('webauthn/registration/verify')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Verify and save a registered passkey' })
  @ApiBody({ type: WebAuthnRegistrationVerifyDto })
  @ApiOkResponse({ description: 'Passkey registered.' })
  async verifyWebAuthnRegistration(
    @CurrentUser() user: User,
    @Body() dto: WebAuthnRegistrationVerifyDto,
  ) {
    return this.webAuthnService.verifyRegistration(
      user.id,
      dto.challengeToken,
      dto.response,
      dto.name ?? 'Passkey',
    );
  }

  @AuthThrottle()
  @Public()
  @Post('webauthn/authentication/options')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create passkey authentication options after password verification' })
  @ApiBody({ type: WebAuthnAuthenticationOptionsDto })
  @ApiOkResponse({ description: 'Authentication options and a short-lived challenge token.' })
  async getWebAuthnAuthenticationOptions(
    @Body() dto: WebAuthnAuthenticationOptionsDto,
  ) {
    return this.webAuthnService.authenticationOptions(dto.twoFactorToken);
  }

  @AuthThrottle()
  @Public()
  @Post('webauthn/authentication/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify a passkey and complete login' })
  @ApiBody({ type: WebAuthnAuthenticationVerifyDto })
  @ApiOkResponse({ description: 'Login successful.' })
  async verifyWebAuthnAuthentication(
    @Body() dto: WebAuthnAuthenticationVerifyDto,
    @Req() request: Request,
  ) {
    const authContext = await this.webAuthnService.verifyAuthentication(
      dto.twoFactorToken,
      dto.challengeToken,
      dto.response,
    );
    return this.authService.completePasskeyLogin(
      authContext.userId,
      request.ip,
      request.headers['user-agent'],
      authContext.deviceId,
    );
  }

  @AuthThrottle()
  @Get('webauthn/credentials')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'List registered passkeys' })
  @ApiOkResponse({ description: 'Passkey metadata; public keys are never returned.' })
  async listWebAuthnCredentials(@CurrentUser() user: User) {
    return this.webAuthnService.listCredentials(user.id);
  }

  @AuthThrottle()
  @Patch('webauthn/credentials/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Rename a passkey' })
  @ApiBody({ type: RenameWebAuthnCredentialDto })
  @ApiOkResponse({ description: 'Passkey renamed.' })
  async renameWebAuthnCredential(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: RenameWebAuthnCredentialDto,
  ) {
    return this.webAuthnService.renameCredential(user.id, id, dto.name);
  }

  @AuthThrottle()
  @Delete('webauthn/credentials/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Delete a passkey' })
  @ApiNoContentResponse({ description: 'Passkey deleted.' })
  async deleteWebAuthnCredential(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ): Promise<void> {
    return this.webAuthnService.deleteCredential(user.id, id);
  }

  @AuthThrottle()
  @Public()
  @Get('login-alerts/:token/report')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm a report of an unrecognized sign-in' })
  @ApiOkResponse({ description: 'Confirmation page for the sign-in report.' })
  async confirmUnrecognizedLogin(
    @Param('token') token: string,
    @Res() response: Response,
  ) {
    const actionUrl = `/v1/auth/login-alerts/${encodeURIComponent(token)}/report`;
    return response
      .status(HttpStatus.OK)
      .type('html')
      .send(
        '<!doctype html><html><head><meta charset="utf-8">' +
          '<meta name="viewport" content="width=device-width, initial-scale=1">' +
          '<title>Secure your FacilPay account</title></head><body>' +
          '<main><h1>Report this sign-in?</h1>' +
          '<p>Confirming will revoke all account sessions and require a password reset.</p>' +
          `<form method="post" action="${actionUrl}">` +
          '<button type="submit">Revoke sessions and reset password</button>' +
          '</form></main></body></html>',
      );
  }

  @AuthThrottle()
  @Public()
  @Post('login-alerts/:token/report')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Report an unrecognized sign-in and secure the account' })
  @ApiOkResponse({ description: 'Sessions revoked and password reset started.' })
  async reportUnrecognizedLogin(@Param('token') token: string) {
    return this.loginAlertsService.reportNotMe(token);
  }

  @AuthThrottle()
  @Patch('login-alerts/preference')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Enable or disable new-device email alerts' })
  @ApiBody({ type: LoginAlertPreferenceDto })
  @ApiOkResponse({ description: 'New-device alert preference updated.' })
  async setLoginAlertPreference(
    @CurrentUser() user: User,
    @Body() dto: LoginAlertPreferenceDto,
  ) {
    return this.loginAlertsService.setPreference(user.id, dto.enabled);
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
  async enableTwoFactor(@CurrentUser() user: User, @Req() req: Request) {
    return this.authService.enableTwoFactor(user.id, req.ip, req.headers['user-agent']);
  }

  @AuthThrottle()
  @Post('2fa/verify')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Verify and activate two-factor authentication',
    description:
      'Checks the current TOTP code from the authenticator app and turns 2FA on when valid. Rate limited to 5 requests per 15 minutes. Failed attempts are tracked against the account lockout counter — the account will be locked after the configured number of failed attempts.',
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
  @ApiTooManyRequestsResponse({
    description: 'Too many requests. Rate limit exceeded.',
    schema: {
      example: {
        statusCode: 429,
        message: 'ThrottlerException: Too Many Requests',
      },
    },
  })
  @ApiResponse({
    status: 423,
    description: 'Account locked due to too many failed verification attempts.',
    schema: {
      example: {
        statusCode: 423,
        message: 'Account is locked. Please try again in 900 seconds.',
        error: 'Locked',
      },
    },
  })
  async verifyTwoFactor(
    @CurrentUser() user: User,
    @Body() dto: TwoFactorCodeDto,
    @Req() req: Request,
  ) {
    return this.authService.verifyTwoFactor(user.id, dto, req?.ip, req?.headers?.['user-agent'] as string | undefined);
  }

  @AuthThrottle()
  @Post('2fa/disable')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Disable two-factor authentication',
    description:
      'Requires password confirmation and then removes the stored encrypted secret and disables 2FA. ' +
      'Rate limited to 5 requests per 15 minutes. Wrong passwords are tracked against the account ' +
      'lockout counter shared with the login endpoint — the account will be locked after the ' +
      'configured number of failed attempts.',
  })
  @ApiBody({ type: DisableTwoFactorDto })
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
    description: 'Invalid password.',
    schema: {
      example: {
        statusCode: 401,
        message: 'Invalid password',
        error: 'Unauthorized',
      },
    },
  })
  @ApiResponse({
    status: 423,
    description: 'Account locked due to too many failed password attempts.',
    schema: {
      example: {
        statusCode: 423,
        message: 'Account is locked. Please try again in 900 seconds.',
        error: 'Locked',
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
  @ApiBadRequestResponse({
    description: 'Two-factor authentication is not enabled.',
  })
  async disableTwoFactor(
    @CurrentUser() user: User,
    @Body() dto: DisableTwoFactorDto,
    @Req() req: Request,
  ) {
    return this.authService.disableTwoFactor(user.id, dto, req?.ip, req?.headers?.['user-agent'] as string | undefined);
  }

  @Post('step-up')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Perform step-up authentication',
    description:
      'Re-authenticates the current user by verifying their password or TOTP code and returns a short-lived step-up token valid for 5 minutes. Required before sensitive operations like creating/rotating admin-scope API keys or assigning high-privilege roles.',
  })
  @ApiBody({ type: StepUpDto })
  @ApiOkResponse({
    description: 'Step-up authentication successful.',
    type: StepUpConfirmationDto,
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid password or TOTP code.',
    schema: {
      example: {
        statusCode: 401,
        message: 'Invalid password',
        error: 'Unauthorized',
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Neither password nor TOTP code was provided.',
    schema: {
      example: {
        statusCode: 400,
        message: 'Either password or totpCode is required',
        error: 'Bad Request',
      },
    },
  })
  async stepUp(
    @CurrentUser() user: User,
    @Body() dto: StepUpDto,
    @Req() req: Request,
  ): Promise<StepUpConfirmationDto> {
    return this.authService.stepUp(user.id, dto, req.ip, req.headers['user-agent']);
  }

  @Post('2fa/backup-codes/regenerate')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Regenerate two-factor backup codes',
    description:
      'Requires the account password or a valid TOTP code. Replaces the current backup codes with a fresh set of 10 without changing the TOTP secret or requiring /2fa/verify again.',
  })
  @ApiBody({ type: RegenerateBackupCodesDto })
  @ApiOkResponse({
    description: 'Backup codes regenerated.',
    schema: {
      example: {
        backupCodes: ['a1b2c3d4', 'e5f6a7b8'],
      },
    },
  })
  @ApiBadRequestResponse({
    description:
      'Two-factor authentication is not enabled, or neither password nor TOTP code was provided.',
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid password or invalid TOTP code.',
    schema: {
      example: {
        statusCode: 401,
        message: 'Invalid password',
        error: 'Unauthorized',
      },
    },
  })
  async regenerateBackupCodes(
    @CurrentUser() user: User,
    @Body() dto: RegenerateBackupCodesDto,
  ) {
    return this.authService.regenerateBackupCodes(user.id, dto);
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

  @AuthThrottle()
  @Public()
  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Resend verification email',
    description:
      'Issues a new 24-hour verification link for an unverified account. Returns the same generic response regardless of whether the email exists or is already verified, to prevent user enumeration. Rate limited to 5 requests per 15 minutes.',
  })
  @ApiBody({ type: ResendVerificationDto })
  @ApiOkResponse({
    description: 'Verification email resent (if the account is unverified).',
    schema: {
      example: {
        message:
          'If an account with that email exists, a verification link has been sent.',
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
  async resendVerification(@Body() dto: ResendVerificationDto) {
    return this.authService.resendVerificationEmail(dto);
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
  async refresh(@Body() dto: RefreshTokenDto, @Req() req: Request) {
    return this.authService.refresh(dto.refresh_token, {
      ipAddress: extractClientIp(req),
      userAgent: req.headers['user-agent'],
    });
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
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    return this.authService.forgotPassword(dto, req.ip, req.headers['user-agent']);
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
  async resetPassword(@Body() dto: ResetPasswordDto, @Req() req: Request) {
    return this.authService.resetPassword(dto, req.ip, req.headers['user-agent']);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
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
  async unlockAccount(@Param('userId') userId: string, @CurrentUser() user: User, @Req() req: Request) {
    return this.usersService.unlockAccount(userId, user.id, req.ip, req.headers['user-agent']);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('manage_roles')
  @Get('admin/roles')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List all roles (Admin only)',
    description: 'Returns all roles and their permissions. Requires manage_roles permission.',
  })
  @ApiOkResponse({
    description: 'Roles returned successfully.',
  })
  @ApiForbiddenResponse({
    description: 'Insufficient permissions.',
  })
  async getRoles() {
    return this.authService.getRoles();
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('manage_roles')
  @Get('admin/roles/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get a role by ID (Admin only)',
    description: 'Returns a single role with its permissions. Requires manage_roles permission.',
  })
  @ApiParam({ name: 'id', description: 'Role ID' })
  @ApiOkResponse({
    description: 'Role returned successfully.',
  })
  @ApiForbiddenResponse({
    description: 'Insufficient permissions.',
  })
  @ApiResponse({
    status: 404,
    description: 'Role not found.',
  })
  async getRoleById(@Param('id') id: string) {
    return this.authService.getRoleById(id);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('manage_roles')
  @Post('admin/roles')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Create a role (Admin only)',
    description: 'Creates a new role with specified permissions. Requires manage_roles permission.',
  })
  @ApiBody({ type: CreateRoleDto })
  @ApiOkResponse({
    description: 'Role created successfully.',
  })
  @ApiForbiddenResponse({
    description: 'Insufficient permissions.',
  })
  async createRole(@Body() dto: CreateRoleDto) {
    return this.authService.createRole(dto);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('manage_roles')
  @Patch('admin/roles/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update a role (Admin only)',
    description: 'Updates an existing role with new name, permissions, and/or description. Requires manage_roles permission.',
  })
  @ApiParam({ name: 'id', description: 'Role ID' })
  @ApiBody({ type: UpdateRoleDto })
  @ApiOkResponse({
    description: 'Role updated successfully.',
  })
  @ApiForbiddenResponse({
    description: 'Insufficient permissions.',
  })
  @ApiResponse({
    status: 404,
    description: 'Role not found.',
  })
  @ApiBadRequestResponse({
    description: 'Invalid request or role with that name already exists.',
  })
  async updateRole(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.authService.updateRole(id, dto);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('manage_roles')
  @Delete('admin/roles/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a role (Admin only)',
    description: 'Deletes an existing role if no users currently have it assigned. Requires manage_roles permission.',
  })
  @ApiParam({ name: 'id', description: 'Role ID' })
  @ApiNoContentResponse({
    description: 'Role deleted successfully.',
  })
  @ApiForbiddenResponse({
    description: 'Insufficient permissions.',
  })
  @ApiResponse({
    status: 404,
    description: 'Role not found.',
  })
  @ApiBadRequestResponse({
    description: 'Cannot delete role with users assigned.',
  })
  async deleteRole(@Param('id') id: string) {
    return this.authService.deleteRole(id);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('assign_roles')
  @Patch('admin/users/:id/role')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Assign role to user (Admin only)',
    description: 'Assigns a role to a user. Requires assign_roles permission.',
  })
  @ApiParam({ name: 'id', description: 'User ID' })
  @ApiBody({ type: AssignRoleDto })
  @ApiOkResponse({
    description: 'Role assigned successfully.',
  })
  @ApiForbiddenResponse({
    description: 'Insufficient permissions.',
  })
  async assignRole(@Param('id') userId: string, @Body() dto: AssignRoleDto, @CurrentUser() user: User, @Req() req: Request) {
    return this.authService.assignRole(userId, dto.roleId, user.id, req.ip, req.headers['user-agent']);
  }

  @AuthThrottle()
  @Public()
  @Post('google/authorize')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Start Sign in with Google (OIDC + PKCE)',
    description:
      'Returns a Google authorization URL with PKCE code_challenge and an opaque state. Fully configurable via GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI and GOOGLE_OIDC_ISSUER.',
  })
  @ApiBody({ type: GoogleAuthorizeDto })
  @ApiOkResponse({
    description: 'Google authorization URL with PKCE parameters.',
    schema: {
      example: {
        url: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=...&code_challenge=...&state=...',
        state: 'c9f0f895fb98ab9159f51fd0297e236d',
        codeVerifier: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
        codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
        expiresAt: '2026-01-26T12:10:00.000Z',
      },
    },
  })
  async googleAuthorize(@Body() dto: GoogleAuthorizeDto) {
    return this.googleOidcService.buildAuthorizeUrl(dto.redirectUri);
  }

  @AuthThrottle()
  @Public()
  @Post('google/callback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Complete Sign in with Google',
    description:
      'Exchanges the Google authorization code with PKCE code_verifier, verifies the ID token, and links to an existing account only by verified email after explicit confirmation (confirmLink=true). Otherwise creates a new verified account.',
  })
  @ApiBody({ type: GoogleCallbackDto })
  @ApiOkResponse({
    description: 'Google sign-in successful.',
    schema: {
      example: {
        access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        refresh_token: '550e8400-e29b-41d4-a716-446655440000',
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Google code exchange or ID token verification failed.' })
  @ApiForbiddenResponse({ description: 'Email not verified or linking not confirmed.' })
  async googleCallback(@Body() dto: GoogleCallbackDto, @Req() req: Request) {
    return this.googleOidcService.handleCallback(
      dto.code,
      dto.codeVerifier,
      dto.state,
      dto.redirectUri,
      dto.confirmLink,
      extractClientIp(req as never) ?? (req as unknown as { ip?: string }).ip,
      (req.headers?.['user-agent'] as string | undefined),
    );
  }

  @Public()
  @Get('sep10/challenge')
  @ApiOperation({
    summary: 'SEP-10 Stellar challenge',
    description:
      'Returns a replay-protected SEP-10 challenge transaction for the given Stellar account, signed by the server. Sign it with the Stellar account to authenticate via POST /v1/auth/sep10/token.',
  })
  @ApiQuery({ name: 'account', required: true, description: 'Stellar public key (G...)' })
  @ApiQuery({ name: 'homeDomain', required: false, description: 'Optional home domain override' })
  @ApiOkResponse({
    description: 'SEP-10 challenge transaction (base64 XDR).',
    schema: {
      example: {
        transaction: 'AAAAAg...',
        networkPassphrase: 'Test SDF Network ; September 2015',
        homeDomain: 'auth.facilpay.com',
        expiresAt: '2026-01-26T12:15:00.000Z',
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Invalid Stellar account or SEP-10 not configured.' })
  async sep10Challenge(@Query('account') account: string, @Query('homeDomain') homeDomain?: string) {
    const dto: Sep10ChallengeDto = { account, homeDomain };
    if (!/^G[A-Z2-7]{55}$/.test(dto.account)) {
      throw new BadRequestException('account must be a valid Stellar public key (G...)');
    }
    return this.sep10Service.buildChallenge(dto.account, dto.homeDomain);
  }

  @AuthThrottle()
  @Public()
  @Post('sep10/token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'SEP-10 Stellar token',
    description:
      'Verifies a signed SEP-10 challenge transaction (replay-protected via time bounds and single-use nonce, requiring both server and client signatures) and binds it to a user, returning app access and refresh tokens.',
  })
  @ApiBody({ type: Sep10TokenDto })
  @ApiOkResponse({
    description: 'SEP-10 authentication successful.',
    schema: {
      example: {
        access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        refresh_token: '550e8400-e29b-41d4-a716-446655440000',
        stellarAccount: 'G...',
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Challenge verification failed or challenge already used.' })
  async sep10Token(@Body() dto: Sep10TokenDto, @Req() req: Request) {
    return this.sep10Service.verifyChallengeAndLogin(
      dto.transaction,
      extractClientIp(req as never) ?? (req as unknown as { ip?: string }).ip,
      (req.headers?.['user-agent'] as string | undefined),
    );
  }
}
