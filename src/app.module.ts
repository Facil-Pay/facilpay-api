import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './modules/database/database.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { LoggerModule } from './modules/logger/logger.module';
import { HttpLoggerMiddleware } from './modules/logger/http-logger.middleware';
import { ThrottlerConfigModule } from './modules/throttler/throttler.config.module';
import { StellarModule } from './modules/stellar/stellar.module';
import { CorsModule } from './modules/cors/cors.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerConfigModule,
    LoggerModule,
    CorsModule,
    DatabaseModule,
    HealthModule,
    UsersModule,
    AuthModule,
    PaymentsModule,
    StellarModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(HttpLoggerMiddleware).forRoutes('*');
  }
}
