import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppLogger } from './modules/logger/logger.service';
import { ValidationPipe, UnprocessableEntityException } from '@nestjs/common';
import { CorsConfigService } from './modules/cors/cors-config.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

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

  if (process.env.NODE_ENV !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('FacilPay API')
      .setDescription(
        'FacilPay payment processing API.\n\n' +
        '## Authentication\n' +
        '- **JWT Bearer**: Obtain a token via `POST /v1/auth/login` and pass it as `Authorization: Bearer <token>`.\n' +
        '- **API Key**: Pass your API key as the `X-API-Key` header for server-to-server requests.\n\n' +
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
          bearerFormat: 'JWT',
          description: 'JWT access token obtained from POST /v1/auth/login',
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
