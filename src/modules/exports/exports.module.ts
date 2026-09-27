import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ExportsController } from './exports.controller';
import { ExportsService } from './exports.service';
import { ExportsProcessor } from './exports.processor';
import { ExportsStorageService } from './exports-storage.service';
import { ExportsDownloadGuard } from './exports-download.guard';
import { PaymentsExporter } from '../payments/export/payments-exporter';
import { MailModule } from '../mail/mail.module';

/**
 * Registers the asynchronous export pipeline:
 * - `POST /v1/exports` enqueues a job on the BullMQ `exports` queue.
 * - `ExportsProcessor` streams rows in batches and writes the file through
 *   the pluggable `ExportsStorageService` (local disk by default).
 * - `GET /v1/exports/:id` reports status and `GET /v1/exports/:id/download`
 *   serves the file via a signed, expiring, owner-only URL.
 *
 * The existing synchronous `GET /v1/payments/export` endpoint is untouched
 * and remains available for small ranges.
 */
@Module({
  imports: [
    ConfigModule,
    MailModule,
    BullModule.registerQueueAsync({
      name: 'exports',
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        defaultJobOptions: {
          attempts: config.get<number>('EXPORTS_JOB_ATTEMPTS', 3),
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: { age: config.get<number>('EXPORTS_RETENTION_SECONDS', 7 * 24 * 60 * 60) },
          removeOnFail: { age: config.get<number>('EXPORTS_RETENTION_SECONDS', 7 * 24 * 60 * 60) },
        },
      }),
    }),
  ],
  controllers: [ExportsController],
  providers: [
    ExportsService,
    ExportsProcessor,
    ExportsStorageService,
    ExportsDownloadGuard,
    PaymentsExporter,
  ],
  exports: [ExportsService, ExportsStorageService],
})
export class ExportsModule {}
