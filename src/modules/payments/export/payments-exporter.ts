import { Readable } from 'stream';
import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';

import { PaymentsService } from '../payments.service';
import { ExportStorageService } from '../../exports/export-storage.service';
import { ExportJobStatus, ExportFormat, ExportType } from '../../exports/export.types';

export interface PaymentExportFilters {
  merchantId?: string;
  from?: string;
  to?: string;
  status?: string;
}

export interface PaymentExportOptions {
  format?: ExportFormat;
  filters?: PaymentExportFilters;
}

/**
 * Number of rows fetched per batch while streaming an export. Keeps memory
 * bounded regardless of how many payments a merchant has.
 */
export const EXPORT_BATCH_SIZE = 1000;

/**
 * Row threshold above which an export is dispatched to the background queue
 * instead of being built synchronously on the request thread.
 */
export const SYNC_EXPORT_ROW_LIMIT = 5000;

@Injectable()
export class PaymentsExporter {
  private readonly logger = new Logger(PaymentsExporter.name);

  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly storage: ExportStorageService,
    @InjectQueue('exports') private readonly exportsQueue: Queue,
  ) {}

  /**
   * Synchronous export used by `GET /v1/payments/export` for small ranges.
   * Streams rows in batches so even the sync path stays memory-bounded.
   */
  async exportSync(options: PaymentExportOptions = {}): Promise<Readable> {
    const format = options.format ?? ExportFormat.CSV;
    const filters = options.filters ?? {};

    const total = await this.paymentsService.count(filters);
    if (total > SYNC_EXPORT_ROW_LIMIT) {
      throw new Error(
        `Export too large for synchronous download (${total} rows). ` +
          'Use POST /v1/exports to run it as a background job.',
      );
    }

    return this.streamRows(filters, format);
  }

  /**
   * Enqueue a background export job and return its id. The worker streams rows
   * in batches, writes the file through the storage adapter and emails the
   * owner once the signed download URL is ready.
   */
  async enqueueExport(
    ownerId: string,
    options: PaymentExportOptions = {},
  ): Promise<{ id: string; status: ExportJobStatus }> {
    const id = randomUUID();
    const format = options.format ?? ExportFormat.CSV;
    const filters = options.filters ?? {};

    await this.exportsQueue.add(
      'payments-export',
      {
        id,
        ownerId,
        type: ExportType.PAYMENTS,
        format,
        filters,
      },
      {
        jobId: id,
        removeOnComplete: false,
        removeOnFail: false,
      },
    );

    this.logger.log(`Queued payments export ${id} for owner ${ownerId}`);
    return { id, status: ExportJobStatus.QUEUED };
  }

  /**
   * Streams payment rows in fixed-size batches, yielding a readable stream of
   * serialized rows. Used by both the sync endpoint and the queue worker.
   */
  async streamRows(
    filters: PaymentExportFilters,
    format: ExportFormat,
  ): Promise<Readable> {
    const self = this;
    let offset = 0;
    let done = false;

    async function* generate(): AsyncGenerator<string> {
      if (format === ExportFormat.CSV) {
        yield 'id,merchantId,amount,currency,status,createdAt\n';
      }

      while (!done) {
        const batch = await self.paymentsService.findBatch(
          filters,
          offset,
          EXPORT_BATCH_SIZE,
        );

        if (batch.length === 0) {
          done = true;
          break;
        }

        for (const payment of batch) {
          yield self.serializeRow(payment, format);
        }

        offset += batch.length;
        if (batch.length < EXPORT_BATCH_SIZE) {
          done = true;
        }
      }
    }

    return Readable.from(generate());
  }

  /**
   * Persists a completed export through the pluggable storage adapter and
   * returns a signed, expiring download URL.
   */
  async persistExport(
    id: string,
    ownerId: string,
    stream: Readable,
    format: ExportFormat,
  ): Promise<{ key: string; downloadUrl: string; expiresAt: Date }> {
    const key = `exports/${ownerId}/${id}.${format}`;
    await this.storage.put(key, stream);
    const { url, expiresAt } = await this.storage.getSignedUrl(key);
    return { key, downloadUrl: url, expiresAt };
  }

  private serializeRow(payment: any, format: ExportFormat): string {
    if (format === ExportFormat.CSV) {
      return [
        payment.id,
        payment.merchantId,
        payment.amount,
        payment.currency,
        payment.status,
        payment.createdAt?.toISOString?.() ?? payment.createdAt,
      ].join(',') + '\n';
    }

    return JSON.stringify(payment) + '\n';
  }
}
