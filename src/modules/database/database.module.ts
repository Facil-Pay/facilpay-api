import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DatabaseLoggerService } from './database-logger.service';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get<string>('DATABASE_HOST', 'localhost'),
        port: configService.get<number>('DATABASE_PORT', 5432),
        username: configService.get<string>('DATABASE_USERNAME', 'postgres'),
        password: configService.get<string>('DATABASE_PASSWORD', 'password'),
        database: configService.get<string>('DATABASE_NAME', 'facilpay'),
        entities: [__dirname + '/../../**/*.entity{.ts,.js}'],
        synchronize:
          configService.get<string>('DATABASE_SYNCHRONIZE', 'false') === 'true',
        logging: configService.get<string>('NODE_ENV') === 'development',
        extra: {
          min: configService.get<number>('DB_POOL_MIN', 2),
          max: configService.get<number>('DB_POOL_MAX', 10),
          idleTimeoutMillis: configService.get<number>('DB_POOL_IDLE_TIMEOUT_MS', 30000),
          connectionTimeoutMillis: configService.get<number>('DB_POOL_CONNECTION_TIMEOUT_MS', 5000),
        },
        maxQueryExecutionTime: configService.get<number>('DB_SLOW_QUERY_THRESHOLD_MS', 500),
      }),
    }),
  ],
  providers: [DatabaseLoggerService],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
