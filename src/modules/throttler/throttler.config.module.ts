import { Module } from '@nestjs/common';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';

@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60000,
        limit: 100,
      },
      {
        name: 'auth',
        ttl: 900000, // 15 minutes
        limit: 5,
      },
      {
        name: 'login',
        ttl: 60000, // 1 minute
        limit: 5, // 5 req/min per IP for login
      },
      {
        name: 'register',
        ttl: 600000, // 10 minutes
        limit: 3, // 3 req/10min per IP for register
      },
      {
        name: 'bulk',
        ttl: 60000,
        limit: 20,
      },
      {
        name: 'webhook',
        ttl: 60000,
        limit: 1000,
      },
    ]),
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class ThrottlerConfigModule {}
