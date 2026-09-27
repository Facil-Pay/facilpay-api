import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { promises as fs } from 'fs';
import { join } from 'path';
import { Queue, Worker, Job } from 'bullmq';
import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';

/**
 * Supported export types. Only payments is implemented today; the union keeps
 * the API forward compatible with future exporters.
 */
export type ExportType = 'payments';

/**
 * Supported output formats for an export.
 */
export type ExportFormat = 'csv' | 'pdf';

/**
 * Filters accepted by the payments exporter. Kept intentionally loose so the
 * caller can pass through the same query params used by the sync endpoint.
 */
export interface ExportFilters {
  from?: string;
  to?: string;
  status?: string;
  currency?: string;
  [key: string]: unknown;
}

/**
 * Public status of an export job.
 */
export type ExportStatus = 'queued' | 'processing' | 'completed' | 'failed';

/**
 * Shape returned by POST /v1/exports and GET /v1/exports/:id.
 */
export interface ExportJobView {
  id: string;
  type: ExportType;
  format: ExportFormat;
  status: ExportStatus;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  rowCount?: number;
  error?: string;
  downloadUrl?: string;
  expiresAt?: string;
}

/**
 * Internal record persisted alongside the job. Kept in memory here; a real
 * deployment would back this with the same store used for the queue.
 */
interface ExportRecord {
  id: string;
  type: ExportType;
  format: ExportFormat;
  filters: ExportFilters;
  ownerId: string;
  status: ExportStatus;
  createdAt: string;
  updatedAt: string;
  rowCount?: number;
  error?: string;
  filePath?: string;
  expiresAt?: string;
}

/**
 * Pluggable storage adapter. The default writes to local disk; callers can
 * swap in S3/GCS by providing their own implementation.
 */
export interface ExportStorageAdapter {
  save(key: string, data: Buffer | string): Promise<string>;
  remove(key: string): Promise<void>;
}

/**
 * Minimal local-disk storage adapter used by default.
 */
export class LocalDiskStorageAdapter implements ExportStorageAdapter {
  constructor(private readonly baseDir: string) {}

  async save(key: string, data: Buffer | string): Promise<string> {
    await fs.mkdir(this.baseDir, { recursive: true });
    const filePath = join(this.baseDir, key);
    await fs.writeFile(filePath, data);
    return filePath;
  }

  async remove(key: string): Promise<void> {
    const filePath = join(this.baseDir, key);
    await fs.rm(filePath, { force: true });
  }
}

/**
 * Source of payment rows. The payments module provides an implementation that
 * streams rows in batches so exports never load the full result set at once.
 */
export interface PaymentsExportSource {
  /**
   * Stream payment rows matching the filters in batches. Implementations must
   * yield plain objects; the exporter serialises them to the requested format.
   */
  streamPayments(filters: ExportFilters, batchSize: number): AsyncIterable<Record<string, unknown>[]>;
}

/**
 * Notifier used to email the owner when an export finishes. Optional so the
 * service can run without a mailer configured (e.g. in tests).
 */
export interface ExportNotifier {
  notifyExportReady(ownerId: string, job: ExportJobView): Promise<void>;
}

/**
 * Options for the exports service. All are optional so the module can be
 * wired with sensible defaults.
 */
export interface ExportsServiceOptions {
  queueName?: string;
  connection?: { host?: string; port?: number };
  storage?: ExportStorageAdapter;
  storageDir?: string;
  source?: PaymentsExportSource;
  notifier?: ExportNotifier;
  /** Number of days a generated file remains downloadable. */
  retentionDays?: number;
  /** Rows fetched per batch while streaming. */
  batchSize?: number;
  /** Secret used to sign download URLs. */
  signingSecret?: string;
  /** Base URL used when building download links. */
  publicBaseUrl?: string;
}

const DEFAULT_RETENTION_DAYS = 7;
const DEFAULT_BATCH_SIZE = 1000;
const DEFAULT_QUEUE_NAME = 'exports';
const DEFAULT_STORAGE_DIR = join(process.cwd(), 'tmp', 'exports');
const DEFAULT_SIGNING_SECRET = 'exports-dev-secret';
const DEFAULT_PUBLIC_BASE_URL = '';

/**
 * ExportsService owns the lifecycle of asynchronous payment exports:
 *
 *  - POST /v1/exports enqueues a job and returns its id.
 *  - GET  /v1/exports/:id returns status for the owner.
 *  - GET  /v1/exports/:id/download streams the file for a valid signed link.
 *
 * The heavy lifting runs in a BullMQ worker so the request thread never builds
 * the file. Rows are streamed in batches to keep memory bounded regardless of
 * how many payments match the filters.
 */
@Injectable()
export class ExportsService {
  private readonly logger = new Logger(ExportsService.name);
  private readonly records = new Map<string, ExportRecord>();
  private readonly queue: Queue;
  private readonly worker: Worker;
  private readonly storage: ExportStorageAdapter;
  private readonly source?: PaymentsExportSource;
  private readonly notifier?: ExportNotifier;
  private readonly retentionDays: number;
  private readonly batchSize: number;
  private readonly signingSecret: string;
  private readonly publicBaseUrl: string;

  constructor(options: ExportsServiceOptions = {}) {
    this.retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS;
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.signingSecret = options.signingSecret ?? DEFAULT_SIGNING_SECRET;
    this.publicBaseUrl = options.publicBaseUrl ?? DEFAULT_PUBLIC_BASE_URL;
    this.storage = options.storage ?? new LocalDiskStorageAdapter(options.storageDir ?? DEFAULT_STORAGE_DIR);
    this.source = options.source;
    this.notifier = options.notifier;

    const connection = options.connection ?? { host: '127.0.0.1', port: 6379 };
    this.queue = new Queue(options.queueName ?? DEFAULT_QUEUE_NAME, { connection });
    this.worker = new Worker(
      options.queueName ?? DEFAULT_QUEUE_NAME,
      async (job: Job) => this.processJob(job),
      { connection },
    );
    this.worker.on('failed', (job, err) => {
      if (!job) return;
      this.markFailed(job.data.id, err?.message ?? 'export failed');
    });
  }

  /**
   * Enqueue a new export. Returns the job view immediately so the caller can
   * poll GET /v1/exports/:id.
   */
  async createExport(input: {
    type: ExportType;
    format: ExportFormat;
    filters?: ExportFilters;
    ownerId: string;
  }): Promise<ExportJobView> {
    if (input.type !== 'payments') {
      throw new BadRequestException(`Unsupported export type: ${input.type}`);
    }
    if (input.format !== 'csv' && input.format !== 'pdf') {
      throw new BadRequestException(`Unsupported export format: ${input.format}`);
    }

    const now = new Date().toISOString();
    const record: ExportRecord = {
      id: randomUUID(),
      type: input.type,
      format: input.format,
      filters: input.filters ?? {},
      ownerId: input.ownerId,
      status: 'queued',
      createdAt: now,
      updatedAt: now,
    };
    this.records.set(record.id, record);

    await this.queue.add(
      'export',
      { id: record.id },
      { removeOnComplete: true, removeOnFail: false },
    );

    return this.toView(record);
  }

  /**
   * Return the status of an export. Only the owner may read it.
   */
  async getExport(id: string, ownerId: string): Promise<ExportJobView> {
    const record = this.requireOwned(id, ownerId);
    return this.toView(record);
  }

  /**
   * Resolve a download for the owner. Returns the file path and metadata so
   * the controller can stream it.
   */
  async getDownload(id: string, ownerId: string): Promise<{ filePath: string; fileName: string }> {
    const record = this.requireOwned(id, ownerId);
    if (record.status !== 'completed' || !record.filePath) {
      throw new BadRequestException('Export is not ready for download');
    }
    if (record.expiresAt && Date.parse(record.expiresAt) <= Date.now()) {
      throw new ForbiddenException('Download link has expired');
    }
    return {
      filePath: record.filePath,
      fileName: `payments-export-${record.id}.${record.format}`,
    };
  }

  /**
   * Verify a signed download token. Tokens are owner-bound and expire with the
   * file, so a leaked link cannot be reused by another user.
   */
  verifyDownloadToken(id: string, ownerId: string, expiresAt: number, token: string): boolean {
    const expected = this.signDownloadToken(id, ownerId, expiresAt);
    const a = Buffer.from(expected);
    const b = Buffer.from(token ?? '');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  /**
   * Build a signed, expiring download URL for a completed export.
   */
  buildDownloadUrl(record: ExportRecord): string {
    const expiresAt = Date.parse(record.expiresAt ?? new Date().toISOString());
    const token = this.signDownloadToken(record.id, record.ownerId, expiresAt);
    const base = this.publicBaseUrl.replace(/\/$/, '');
    return `${base}/v1/exports/${record.id}/download?expires=${expiresAt}&token=${token}`;
  }

  /**
   * Delete files whose retention window has passed. Intended to be called by a
   * scheduled task; safe to invoke repeatedly.
   */
  async purgeExpired(): Promise<number> {
    const now = Date.now();
    let removed = 0;
    for (const record of this.records.values()) {
      if (record.expiresAt && Date.parse(record.expiresAt) <= now) {
        if (record.filePath) {
          await this.storage.remove(this.storageKey(record.id));
        }
        this.records.delete(record.id);
        removed += 1;
      }
    }
    return removed;
  }

  /**
   * Worker entry point. Streams rows in batches, writes the file through the
   * storage adapter, then notifies the owner.
   */
  private async processJob(job: Job): Promise<void> {
    const record = this.records.get(job.data.id);
    if (!record) return;

    record.status = 'processing';
    record.updatedAt = new Date().toISOString();

    try {
      const { rowCount, filePath } = await this.generateFile(record);
      const expiresAt = new Date(Date.now() + this.retentionDays * 24 * 60 * 60 * 1000).toISOString();

      record.status = 'completed';
      record.rowCount = rowCount;
      record.filePath = filePath;
      record.expiresAt = expiresAt;
      record.updatedAt = new Date().toISOString();

      if (this.notifier) {
        await this.notifier.notifyExportReady(record.ownerId, this.toView(record));
      }
    } catch (err) {
      this.markFailed(record.id, (err as Error)?.message ?? 'export failed');
      throw err;
    }
  }

  /**
   * Stream rows from the source in batches and serialise them to the requested
   * format. Memory stays bounded because only one batch is held at a time.
   */
  private async generateFile(record: ExportRecord): Promise<{ rowCount: number; filePath: string }> {
    if (!this.source) {
      throw new Error('No payments export source configured');
    }

    const chunks: string[] = [];
    let rowCount = 0;
    let header: string[] | undefined;

    for await (const batch of this.source.streamPayments(record.filters, this.batchSize)) {
      for (const row of batch) {
        if (!header) {
          header = Object.keys(row);
          if (record.format === 'csv') {
            chunks.push(header.map((h) => this.csvCell(h)).join(',') + '\n');
          }
        }
        if (record.format === 'csv') {
          chunks.push(header.map((h) => this.csvCell(row[h])).join(',') + '\n');
        } else {
          chunks.push(JSON.stringify(row));
        }
        rowCount += 1;
      }
    }

    const body = record.format === 'csv' ? chunks.join('') : chunks.join('\n');
    const filePath = await this.storage.save(this.storageKey(record.id), body);
    return { rowCount, filePath };
  }

  private markFailed(id: string, message: string): void {
    const record = this.records.get(id);
    if (!record) return;
    record.status = 'failed';
    record.error = message;
    record.updatedAt = new Date().toISOString();
    this.logger.error(`Export ${id} failed: ${message}`);
  }

  private requireOwned(id: string, ownerId: string): ExportRecord {
    const record = this.records.get(id);
    if (!record) {
      throw new NotFoundException('Export not found');
    }
    if (record.ownerId !== ownerId) {
      throw new ForbiddenException('Export belongs to another user');
    }
    return record;
  }

  private toView(record: ExportRecord): ExportJobView {
    const view: ExportJobView = {
      id: record.id,
      type: record.type,
      format: record.format,
      status: record.status,
      ownerId: record.ownerId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
    if (record.rowCount !== undefined) view.rowCount = record.rowCount;
    if (record.error !== undefined) view.error = record.error;
    if (record.status === 'completed' && record.expiresAt) {
      view.downloadUrl = this.buildDownloadUrl(record);
      view.expiresAt = record.expiresAt;
    }
    return view;
  }

  private storageKey(id: string): string {
    return `${id}.export`;
  }

  private signDownloadToken(id: string, ownerId: string, expiresAt: number): string {
    return createHmac('sha256', this.signingSecret)
      .update(`${id}:${ownerId}:${expiresAt}`)
      .digest('hex');
  }

  private csvCell(value: unknown): string {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (/[",\n\r]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }
}
