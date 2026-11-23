import { initializeTracing } from './tracing';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppLogger } from './modules/logger/logger.service';
import { ValidationPipe, UnprocessableEntityException } from '@nestjs/common';
import { CorsConfigService } from './modules/cors/cors-config.service';
import { parseTrustedProxyList } from './modules/merchants/ip-utils';

// Initialize tracing before app bootstrap
initializeTracing();

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // Only trust X-Forwarded-For when the connecting peer is a known reverse
  // proxy. When TRUSTED_PROXY_IPS is unset (direct exposure) the header is
  // never trusted, so req.ip stays the socket peer address.
  const trustedProxies = parseTrustedProxyList(process.env.TRUSTED_PROXY_IPS);
  if (trustedProxies.length > 0) {
    app.getHttpAdapter().getInstance().set('trust proxy', trustedProxies);
  }

  const corsConfigService = app.get(CorsConfigService);
  app.enableCors(corsConfigService.getCorsOptions());

  // Configure global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
      exceptionFactory: (errors) => {
        const messages = errors.flatMap((e) =>
          e.constraints ? Object.values(e.constraints) : [],
        );
        return new UnprocessableEntityException(
          messages.length ? messages : 'Validation failed',
        );
      },
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('FacilPay API')
    .setDescription(
      'FacilPay payment processing API.\n\n' +
      '## Authentication\n' +
      '- **JWT Bearer**: Obtain a token via `POST /v1/auth/login` and pass it as `Authorization: Bearer <token>`.\n' +
      '- **API Key**: Pass your API key as the `X-API-Key` header for server-to-server requests.\n\n' +
      '- **OAuth**: Register an app via `/v1/oauth/apps`, obtain scoped access with PKCE, and send `Authorization: Bearer <access_token>` to delegated endpoints.\n' +
      '- **Signed API keys**: Keys with `requireSignedRequests` require `X-FacilPay-Timestamp` and `X-FacilPay-Signature` using the separate one-time signing secret.\n\n' +
      '## Idempotency\n' +
      'Payment creation supports idempotency via the `Idempotency-Key` request header. ' +
      'Keys are valid for 24 hours. Reusing a key with a different payload returns 409 Conflict.',
    )
    .setVersion('1.0.0')
    .addServer('http://localhost:3000', 'Local development')
    .addServer('https://api.facilpay.com', 'Production')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT or opaque OAuth access token',
        description: 'Merchant JWT from POST /v1/auth/login, or OAuth access token for explicitly scoped endpoints',
      },
      'bearer',
    )
    .addApiKey(
      {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
        description: 'API key for server-to-server requests',
      },
      'api-key',
    )
    .build();

  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);

  // Serve OpenAPI spec at /v1/openapi.json
  app.use('/v1/openapi.json', (req, res) => {
    res.json(swaggerDocument);
  });

  if (process.env.NODE_ENV !== 'production') {
    SwaggerModule.setup('api/docs', app, swaggerDocument, {
      jsonDocumentUrl: 'api/docs-json',
      swaggerOptions: {
        persistAuthorization: true,
        tagsSorter: 'alpha',
        operationsSorter: 'alpha',
      },
    });
  }

  const appLogger = app.get(AppLogger);
  app.useLogger(appLogger);
  app.enableShutdownHooks();

  const logger = appLogger.child({ module: 'Bootstrap' });

  process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    logger.error({ err }, 'Unhandled promise rejection');
  });

  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception');
    process.exit(1);
  });

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  logger.info({ port }, 'Server listening');
}
bootstrap();
