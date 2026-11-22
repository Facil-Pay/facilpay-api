import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { ExportsController } from './exports.controller';
import { DatabaseExportsSource, ExportsService } from './exports.service';

/**
 * Registers the asynchronous export pipeline:
 * - `POST /v1/exports` enqueues a job on the BullMQ `exports` queue.
 * - The service streams merchant-scoped rows in batches and writes the file
 *   through its configured storage adapter.
 * - `GET /v1/exports/:id` reports status and `GET /v1/exports/:id/download`
 *   serves the file via a signed, expiring, owner-only URL.
 *
 * The existing synchronous `GET /v1/payments/export` endpoint is untouched
 * and remains available for small ranges.
 */
@Module({
  controllers: [ExportsController],
  providers: [
    {
      provide: ExportsService,
      inject: [DataSource, ConfigService],
      useFactory: (dataSource: DataSource, configService: ConfigService) =>
        new ExportsService({
          source: new DatabaseExportsSource(dataSource),
          connection: {
            host: configService.get('REDIS_HOST', 'localhost'),
            port: Number(configService.get('REDIS_PORT', '6379')),
          },
          retentionDays: Number(configService.get('EXPORT_RETENTION_DAYS', '7')),
          batchSize: Number(configService.get('EXPORT_BATCH_SIZE', '1000')),
          signingSecret: configService.get(
            'EXPORT_SIGNING_SECRET',
            'exports-dev-secret',
          ),
        }),
    },
  ],
  exports: [ExportsService],
})
export class ExportsModule {}
