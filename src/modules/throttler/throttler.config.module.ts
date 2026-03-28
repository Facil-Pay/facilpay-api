import { Module } from '@nestjs/common';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';

@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60000, // 1 minute in milliseconds
        limit: 100, // 100 requests per minute for general endpoints
      },
      {
        name: 'auth',
        ttl: 900000, // 15 minutes in milliseconds
        limit: 5, // 5 requests per 15 minutes for auth endpoints
      },
      {
        name: 'webhook',
        ttl: 60000, // 1 minute in milliseconds
        limit: 1000, // 1000 requests per minute for webhooks
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
