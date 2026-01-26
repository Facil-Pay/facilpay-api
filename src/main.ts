import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AppLogger } from './modules/logger/logger.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const appLogger = app.get(AppLogger);
  app.useLogger(appLogger);
  app.enableShutdownHooks();

  const logger = appLogger.child({ module: 'Bootstrap' });

  process.on('unhandledRejection', reason => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    logger.error({ err }, 'Unhandled promise rejection');
  });

  process.on('uncaughtException', err => {
    logger.fatal({ err }, 'Uncaught exception');
    process.exit(1);
  });

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  logger.info({ port }, 'Server listening');
}
bootstrap();
