# Issues #24, #26, #27, #29 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement refresh token auth flow, full Swagger docs for payments, expanded E2E payment tests, and email verification for new users.

**Architecture:** Four independent features on top of the existing NestJS/TypeORM/PostgreSQL stack. Refresh tokens and email verification touch `auth` and `users` modules; Swagger docs are controller-only changes; E2E tests expand `test/payments.e2e-spec.ts`. User entity stays in-memory for this iteration — `RefreshToken` gets its own TypeORM entity with a plain `userId` string column (no FK).

**Tech Stack:** NestJS 11, TypeORM 0.3, PostgreSQL, @nestjs/jwt, bcrypt, nodemailer (new), supertest

---

## File Map

### Issue #24 – Refresh Token Flow
| Action | Path |
|--------|------|
| Create | `src/modules/auth/entities/refresh-token.entity.ts` |
| Create | `src/modules/auth/dto/refresh-token.dto.ts` |
| Modify | `src/modules/auth/auth.service.ts` |
| Modify | `src/modules/auth/auth.controller.ts` |
| Modify | `src/modules/auth/auth.module.ts` |
| Modify | `.env.example` |

### Issue #26 – Payment Swagger Docs
| Action | Path |
|--------|------|
| Modify | `src/modules/payments/payments.controller.ts` |

### Issue #27 – Payment E2E Tests
| Action | Path |
|--------|------|
| Modify | `test/payments.e2e-spec.ts` |

### Issue #29 – Email Verification
| Action | Path |
|--------|------|
| Create | `src/modules/auth/mail/mail.service.ts` |
| Create | `src/modules/auth/dto/verify-email-query.dto.ts` |
| Modify | `src/modules/users/user.entity.ts` |
| Modify | `src/modules/users/users.service.ts` |
| Modify | `src/modules/auth/auth.service.ts` |
| Modify | `src/modules/auth/auth.controller.ts` |
| Modify | `src/modules/auth/auth.module.ts` |
| Modify | `.env.example` |

---

## Task 1: RefreshToken Entity

**Files:**
- Create: `src/modules/auth/entities/refresh-token.entity.ts`

- [ ] **Step 1: Create entity**

```typescript
// src/modules/auth/entities/refresh-token.entity.ts
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('refresh_tokens')
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  token: string;

  @Column()
  userId: string;

  @Column({ type: 'timestamp with time zone' })
  expiresAt: Date;

  @Column({ default: false })
  revoked: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
```

- [ ] **Step 2: Create RefreshTokenDto**

```typescript
// src/modules/auth/dto/refresh-token.dto.ts
import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty()
  @ApiProperty({
    description: 'The refresh token obtained at login',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  refresh_token: string;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/auth/entities/refresh-token.entity.ts src/modules/auth/dto/refresh-token.dto.ts
git commit -m "feat(auth): add RefreshToken entity and DTO"
```

---

## Task 2: Auth Service – Refresh Token Logic

**Files:**
- Modify: `src/modules/auth/auth.service.ts`

- [ ] **Step 1: Replace full file**

```typescript
// src/modules/auth/auth.service.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
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

@Injectable()
export class AuthService {
  private readonly logger: Logger;

  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
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

    return {
      message: 'User registered successfully',
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
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/auth/auth.service.ts
git commit -m "feat(auth): add refresh token generation, refresh, and logout logic"
```

---

## Task 3: Auth Controller – /auth/refresh and /auth/logout

**Files:**
- Modify: `src/modules/auth/auth.controller.ts`

- [ ] **Step 1: Replace full file**

```typescript
// src/modules/auth/auth.controller.ts
import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from '../users/dto/register.dto';
import { LoginDto } from '../users/dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { AuthThrottle } from '../throttler/throttler.decorator';
import { Public } from './decorators/public.decorator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiNoContentResponse,
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
      'Authenticates a user and returns a JWT access token, a refresh token, and the user (without password). Rate limited to 5 requests per 15 minutes.',
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
      example: {
        access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
      },
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
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/auth/auth.controller.ts
git commit -m "feat(auth): add /auth/refresh and /auth/logout endpoints"
```

---

## Task 4: Auth Module – Register RefreshToken with TypeORM

**Files:**
- Modify: `src/modules/auth/auth.module.ts`

- [ ] **Step 1: Replace full file**

```typescript
// src/modules/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { UsersModule } from '../users/users.module';
import { JwtStrategy } from './jwt.strategy';
import { RefreshToken } from './entities/refresh-token.entity';

@Module({
  imports: [
    UsersModule,
    PassportModule,
    TypeOrmModule.forFeature([RefreshToken]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET') || 'your-secret-key',
        signOptions: { expiresIn: '24h' },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, JwtAuthGuard, RolesGuard],
  exports: [AuthService, JwtAuthGuard, RolesGuard],
})
export class AuthModule {}
```

- [ ] **Step 2: Update .env.example** – add REFRESH_TOKEN_EXPIRY_DAYS

Add after the JWT_SECRET line:
```
REFRESH_TOKEN_EXPIRY_DAYS=30
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/auth/auth.module.ts .env.example
git commit -m "feat(auth): register RefreshToken entity in AuthModule"
```

---

## Task 5: Payments Controller – Full Swagger Documentation

**Files:**
- Modify: `src/modules/payments/payments.controller.ts`

- [ ] **Step 1: Replace full file**

```typescript
// src/modules/payments/payments.controller.ts
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBody,
  ApiParam,
  ApiHeader,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiUnauthorizedResponse,
  ApiInternalServerErrorResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { PaymentWebhookDto } from './dto/payment-webhook.dto';
import { Payment } from './payment.entity';
import { WebhookThrottle } from '../throttler/throttler.decorator';
import { WebhookGuard } from './webhook.guard';

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a payment',
    description: 'Initiates a new payment record with PENDING status.',
  })
  @ApiBody({ type: CreatePaymentDto })
  @ApiCreatedResponse({
    description: 'Payment created successfully.',
    type: Payment,
    schema: {
      example: {
        id: '123e4567-e89b-12d3-a456-426614174000',
        amount: 100.5,
        currency: 'USD',
        status: 'PENDING',
        description: 'Payment for order #12345',
        externalReference: null,
        createdAt: '2026-01-26T10:00:00.000Z',
        updatedAt: '2026-01-26T10:00:00.000Z',
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Validation failed (invalid amount, missing currency, etc.).',
    schema: {
      example: {
        statusCode: 400,
        message: ['Amount must be a positive number', 'Currency is required'],
        error: 'Bad Request',
      },
    },
  })
  @ApiUnprocessableEntityResponse({
    description: 'Unprocessable entity.',
    schema: {
      example: { statusCode: 422, message: 'Unprocessable Entity' },
    },
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error.',
    schema: {
      example: { statusCode: 500, message: 'Internal server error' },
    },
  })
  create(@Body() createPaymentDto: CreatePaymentDto) {
    return this.paymentsService.create(createPaymentDto);
  }

  @Get()
  @ApiOperation({
    summary: 'List all payments',
    description: 'Returns all payments ordered by creation date (newest first).',
  })
  @ApiOkResponse({
    description: 'List of payments.',
    type: [Payment],
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error.',
    schema: {
      example: { statusCode: 500, message: 'Internal server error' },
    },
  })
  findAll() {
    return this.paymentsService.findAll();
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a payment by ID',
    description: 'Returns a single payment by its UUID.',
  })
  @ApiParam({
    name: 'id',
    description: 'Payment UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiOkResponse({
    description: 'Payment found.',
    type: Payment,
  })
  @ApiNotFoundResponse({
    description: 'Payment not found.',
    schema: {
      example: {
        statusCode: 404,
        message: 'Payment with ID 123e4567-e89b-12d3-a456-426614174000 not found',
        error: 'Not Found',
      },
    },
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error.',
    schema: {
      example: { statusCode: 500, message: 'Internal server error' },
    },
  })
  findOne(@Param('id') id: string) {
    return this.paymentsService.findOne(id);
  }

  @WebhookThrottle()
  @UseGuards(WebhookGuard)
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Handle payment webhook',
    description:
      'Updates payment status from an external provider. Requires a valid HMAC-SHA256 signature in the X-Signature header computed over the raw JSON body using the configured WEBHOOK_SECRET.',
  })
  @ApiHeader({
    name: 'X-Signature',
    description:
      'HMAC-SHA256 hex digest of the raw request body, keyed with WEBHOOK_SECRET',
    required: true,
    example: 'a1b2c3d4e5f6...',
  })
  @ApiBody({ type: PaymentWebhookDto })
  @ApiOkResponse({
    description: 'Webhook processed successfully.',
    type: Payment,
    schema: {
      example: {
        id: '123e4567-e89b-12d3-a456-426614174000',
        amount: 100.5,
        currency: 'USD',
        status: 'COMPLETED',
        externalReference: 'ext_ref_12345',
        description: 'Payment for order #12345',
        createdAt: '2026-01-26T10:00:00.000Z',
        updatedAt: '2026-01-26T10:05:00.000Z',
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Missing or invalid X-Signature header, or invalid body.',
    schema: {
      example: {
        statusCode: 400,
        message: 'Missing X-Signature header. Please verify the webhook is correctly configured.',
        error: 'Bad Request',
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Unauthorized webhook source.',
    schema: {
      example: {
        statusCode: 400,
        message: 'Invalid webhook signature. Unauthorised webhook source.',
        error: 'Bad Request',
      },
    },
  })
  @ApiNotFoundResponse({
    description: 'Payment not found.',
    schema: {
      example: {
        statusCode: 404,
        message: 'Payment with ID 123e4567-e89b-12d3-a456-426614174000 not found',
        error: 'Not Found',
      },
    },
  })
  @ApiInternalServerErrorResponse({
    description: 'Internal server error.',
    schema: {
      example: { statusCode: 500, message: 'Internal server error' },
    },
  })
  handleWebhook(@Body() webhookDto: PaymentWebhookDto) {
    return this.paymentsService.handleWebhook(webhookDto);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/payments/payments.controller.ts
git commit -m "docs(payments): add full OpenAPI/Swagger annotations to payments controller"
```

---

## Task 6: Expand Payment E2E Tests

**Files:**
- Modify: `test/payments.e2e-spec.ts`

Note: Tests use a real NestJS app + real DB. `WEBHOOK_SECRET` must be set in the test environment for webhook signature tests; if not set, WebhookGuard will reject with 400.

- [ ] **Step 1: Replace full file**

```typescript
// test/payments.e2e-spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import * as crypto from 'crypto';
import { AppModule } from './../src/app.module';

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';

function generateSignature(body: object): string {
  return crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(JSON.stringify(body))
    .digest('hex');
}

describe('PaymentsModule (e2e)', () => {
  let app: INestApplication<App>;
  let paymentId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  // ── POST /payments ──────────────────────────────────────────────────────────

  describe('POST /payments', () => {
    it('creates a payment and returns 201 with PENDING status', async () => {
      const response = await request(app.getHttpServer())
        .post('/payments')
        .send({ amount: 50.0, currency: 'EUR', description: 'E2E Test payment' })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.status).toBe('PENDING');
      expect(response.body.currency).toBe('EUR');
      paymentId = response.body.id;
    });

    it('returns 400 when amount is missing', async () => {
      const response = await request(app.getHttpServer())
        .post('/payments')
        .send({ currency: 'USD' })
        .expect(400);

      expect(response.body.statusCode).toBe(400);
    });

    it('returns 400 when amount is zero', async () => {
      await request(app.getHttpServer())
        .post('/payments')
        .send({ amount: 0, currency: 'USD' })
        .expect(400);
    });

    it('returns 400 when currency is missing', async () => {
      await request(app.getHttpServer())
        .post('/payments')
        .send({ amount: 10 })
        .expect(400);
    });

    it('returns 400 when currency exceeds 3 characters', async () => {
      await request(app.getHttpServer())
        .post('/payments')
        .send({ amount: 10, currency: 'USDD' })
        .expect(400);
    });
  });

  // ── GET /payments ───────────────────────────────────────────────────────────

  describe('GET /payments', () => {
    it('returns 200 with an array of payments', async () => {
      const response = await request(app.getHttpServer())
        .get('/payments')
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
    });
  });

  // ── GET /payments/:id ───────────────────────────────────────────────────────

  describe('GET /payments/:id', () => {
    it('returns 200 with payment details for a valid ID', async () => {
      const response = await request(app.getHttpServer())
        .get(`/payments/${paymentId}`)
        .expect(200);

      expect(response.body.id).toBe(paymentId);
      expect(response.body).toHaveProperty('amount');
      expect(response.body).toHaveProperty('currency');
      expect(response.body).toHaveProperty('status');
    });

    it('returns 404 for a non-existent payment ID', async () => {
      const nonExistentId = '00000000-0000-4000-a000-000000000000';
      const response = await request(app.getHttpServer())
        .get(`/payments/${nonExistentId}`)
        .expect(404);

      expect(response.body.statusCode).toBe(404);
    });
  });

  // ── POST /payments/webhook ──────────────────────────────────────────────────

  describe('POST /payments/webhook', () => {
    it('returns 400 when X-Signature header is missing', async () => {
      await request(app.getHttpServer())
        .post('/payments/webhook')
        .send({ paymentId, status: 'COMPLETED' })
        .expect(400);
    });

    it('returns 400 when X-Signature is invalid', async () => {
      await request(app.getHttpServer())
        .post('/payments/webhook')
        .set('X-Signature', 'invalid-signature')
        .send({ paymentId, status: 'COMPLETED' })
        .expect(400);
    });

    it('updates payment status to COMPLETED with valid signature', async () => {
      const body = {
        paymentId,
        status: 'COMPLETED',
        externalReference: 'EXT-E2E-123',
      };
      const signature = generateSignature(body);

      const response = await request(app.getHttpServer())
        .post('/payments/webhook')
        .set('X-Signature', signature)
        .send(body)
        .expect(200);

      expect(response.body.status).toBe('COMPLETED');
      expect(response.body.externalReference).toBe('EXT-E2E-123');
    });

    it('updates payment status to FAILED with valid signature', async () => {
      const newPayment = await request(app.getHttpServer())
        .post('/payments')
        .send({ amount: 25.0, currency: 'GBP' })
        .expect(201);

      const body = { paymentId: newPayment.body.id, status: 'FAILED' };
      const signature = generateSignature(body);

      const response = await request(app.getHttpServer())
        .post('/payments/webhook')
        .set('X-Signature', signature)
        .send(body)
        .expect(200);

      expect(response.body.status).toBe('FAILED');
    });

    it('returns 404 via webhook for a non-existent payment ID', async () => {
      const nonExistentId = '00000000-0000-4000-a000-000000000000';
      const body = { paymentId: nonExistentId, status: 'COMPLETED' };
      const signature = generateSignature(body);

      await request(app.getHttpServer())
        .post('/payments/webhook')
        .set('X-Signature', signature)
        .send(body)
        .expect(404);
    });
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add test/payments.e2e-spec.ts
git commit -m "test(payments): expand E2E tests with validation, not-found, and webhook cases"
```

---

## Task 7: Install nodemailer

- [ ] **Step 1: Install dependency**

```bash
npm install nodemailer
npm install --save-dev @types/nodemailer
```

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add nodemailer dependency for email verification"
```

---

## Task 8: Email Verification – User Entity + UsersService

**Files:**
- Modify: `src/modules/users/user.entity.ts`
- Modify: `src/modules/users/users.service.ts`

- [ ] **Step 1: Update User entity**

```typescript
// src/modules/users/user.entity.ts
import { UserRole } from '../../common/constants/roles';

export class User {
  id: string;
  email: string;
  password: string;
  roles: UserRole[] = [UserRole.USER];
  isEmailVerified: boolean = false;
  createdAt: Date;
  updatedAt: Date;

  constructor(partial?: Partial<User>) {
    Object.assign(this, partial);
    if (!this.roles) {
      this.roles = [UserRole.USER];
    }
    if (this.isEmailVerified === undefined) {
      this.isEmailVerified = false;
    }
  }
}
```

- [ ] **Step 2: Add verifyEmail method to UsersService**

In `src/modules/users/users.service.ts`, add the following method after `remove()`:

```typescript
  async verifyEmail(id: string): Promise<void> {
    const userIndex = this.users.findIndex((user) => user.id === id);
    if (userIndex === -1) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    this.users[userIndex].isEmailVerified = true;
    this.users[userIndex].updatedAt = new Date();
    this.logger.info({ userId: id }, 'User email verified');
  }
```

Also update `create()` to set `isEmailVerified: false` explicitly:

```typescript
  async create(createUserDto: CreateUserDto): Promise<Omit<User, 'password'>> {
    const hashedPassword = await bcrypt.hash(createUserDto.password, 10);

    const user: User = {
      id: Math.random().toString(36).substring(7),
      email: createUserDto.email,
      password: hashedPassword,
      roles: [UserRole.USER],
      isEmailVerified: false,
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
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/users/user.entity.ts src/modules/users/users.service.ts
git commit -m "feat(users): add isEmailVerified field and verifyEmail service method"
```

---

## Task 9: MailService

**Files:**
- Create: `src/modules/auth/mail/mail.service.ts`

- [ ] **Step 1: Create MailService**

```typescript
// src/modules/auth/mail/mail.service.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private transporter: nodemailer.Transporter;

  constructor(private configService: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host: this.configService.get<string>('SMTP_HOST', 'smtp.ethereal.email'),
      port: this.configService.get<number>('SMTP_PORT', 587),
      secure: this.configService.get<string>('SMTP_SECURE', 'false') === 'true',
      auth: {
        user: this.configService.get<string>('SMTP_USER', ''),
        pass: this.configService.get<string>('SMTP_PASS', ''),
      },
    });
  }

  async sendVerificationEmail(to: string, token: string): Promise<void> {
    const appUrl = this.configService.get<string>(
      'APP_URL',
      'http://localhost:3000',
    );
    const verifyUrl = `${appUrl}/auth/verify-email?token=${token}`;

    await this.transporter.sendMail({
      from: this.configService.get<string>(
        'SMTP_FROM',
        '"FacilPay" <noreply@facilpay.com>',
      ),
      to,
      subject: 'Verify your FacilPay email address',
      text: `Click the link to verify your email: ${verifyUrl}`,
      html: `<p>Click the link to verify your email address:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p><p>This link expires in 24 hours.</p>`,
    });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/auth/mail/mail.service.ts
git commit -m "feat(auth): add MailService for sending verification emails"
```

---

## Task 10: Email Verification – AuthService Updates

**Files:**
- Modify: `src/modules/auth/auth.service.ts`
- Create: `src/modules/auth/dto/verify-email-query.dto.ts`

- [ ] **Step 1: Create VerifyEmailQueryDto**

```typescript
// src/modules/auth/dto/verify-email-query.dto.ts
import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyEmailQueryDto {
  @IsString()
  @IsNotEmpty()
  @ApiProperty({
    description: 'Email verification token from the registration email',
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
  })
  token: string;
}
```

- [ ] **Step 2: Update AuthService to add email verification logic**

Replace the full `src/modules/auth/auth.service.ts` with:

```typescript
// src/modules/auth/auth.service.ts
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
      await this.mailService.sendVerificationEmail(user.email, verificationToken);
    } catch (err) {
      this.logger.warn(
        { userId: user.id, error: err.message },
        'Failed to send verification email',
      );
    }

    return {
      message: 'User registered successfully. Please check your email to verify your account.',
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
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/auth/auth.service.ts src/modules/auth/dto/verify-email-query.dto.ts
git commit -m "feat(auth): add email verification logic and block unverified logins"
```

---

## Task 11: Auth Controller – /auth/verify-email Endpoint

**Files:**
- Modify: `src/modules/auth/auth.controller.ts`

- [ ] **Step 1: Add verify-email endpoint to controller**

Replace full `src/modules/auth/auth.controller.ts`:

```typescript
// src/modules/auth/auth.controller.ts
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
        message: 'User registered successfully. Please check your email to verify your account.',
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
      example: { statusCode: 401, message: 'User already exists', error: 'Unauthorized' },
    },
  })
  @ApiTooManyRequestsResponse({
    description: 'Too many requests.',
    schema: { example: { statusCode: 429, message: 'ThrottlerException: Too Many Requests' } },
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
    schema: { example: { statusCode: 401, message: 'Invalid credentials', error: 'Unauthorized' } },
  })
  @ApiForbiddenResponse({
    description: 'Email not verified.',
    schema: {
      example: {
        statusCode: 403,
        message: 'Email address not verified. Please check your inbox and verify your email before logging in.',
        error: 'Forbidden',
      },
    },
  })
  @ApiTooManyRequestsResponse({
    description: 'Too many requests.',
    schema: { example: { statusCode: 429, message: 'ThrottlerException: Too Many Requests' } },
  })
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Public()
  @Get('verify-email')
  @ApiOperation({
    summary: 'Verify email address',
    description: 'Confirms a user\'s email using the signed JWT token from the verification email. Token expires after 24 hours.',
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
    schema: { example: { statusCode: 401, message: 'Invalid or expired verification token', error: 'Unauthorized' } },
  })
  async verifyEmail(@Query() query: VerifyEmailQueryDto) {
    return this.authService.verifyEmail(query.token);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Refresh access token',
    description: 'Issues a new JWT access token using a valid, non-expired, non-revoked refresh token.',
  })
  @ApiBody({ type: RefreshTokenDto })
  @ApiOkResponse({
    description: 'New access token issued.',
    schema: { example: { access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' } },
  })
  @ApiUnauthorizedResponse({
    description: 'Invalid, expired, or revoked refresh token.',
    schema: { example: { statusCode: 401, message: 'Invalid or expired refresh token', error: 'Unauthorized' } },
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
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/auth/auth.controller.ts
git commit -m "feat(auth): add GET /auth/verify-email endpoint"
```

---

## Task 12: Auth Module – Add MailService

**Files:**
- Modify: `src/modules/auth/auth.module.ts`
- Modify: `.env.example`

- [ ] **Step 1: Update AuthModule**

```typescript
// src/modules/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { UsersModule } from '../users/users.module';
import { JwtStrategy } from './jwt.strategy';
import { RefreshToken } from './entities/refresh-token.entity';
import { MailService } from './mail/mail.service';

@Module({
  imports: [
    UsersModule,
    PassportModule,
    TypeOrmModule.forFeature([RefreshToken]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET') || 'your-secret-key',
        signOptions: { expiresIn: '24h' },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, JwtAuthGuard, RolesGuard, MailService],
  exports: [AuthService, JwtAuthGuard, RolesGuard],
})
export class AuthModule {}
```

- [ ] **Step 2: Update .env.example**

Add SMTP configuration block after the JWT section:

```
# Email / SMTP Configuration
SMTP_HOST=smtp.ethereal.email
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-smtp-username
SMTP_PASS=your-smtp-password
SMTP_FROM="FacilPay" <noreply@facilpay.com>
APP_URL=http://localhost:3000
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/auth/auth.module.ts .env.example
git commit -m "feat(auth): register MailService in AuthModule and document SMTP env vars"
```
