import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { promises as fs } from 'fs';
import { join } from 'path';
import { Queue, Worker, Job } from 'bullmq';
import { createReadStream } from 'fs';
import { Injectable, Logger, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';

export type ExportType =
  | 'payments'
  | 'customers'
  | 'invoices'
  | 'refunds'
  | 'ledger'
  | 'quickbooks_iif'
  | 'quickbooks_csv'
  | 'xero_csv';

type StandardExportType = Exclude<
  ExportType,
  'quickbooks_iif' | 'quickbooks_csv' | 'xero_csv'
>;

/**
 * Supported output formats for an export.
 */
export type ExportFormat = 'csv' | 'pdf' | 'iif';

export interface AccountingAccountMap {
  payments: string;
  fees: string;
  refunds: string;
  payouts: string;
  clearing: string;
}

export interface AccountingAccountMappings {
  quickbooks: AccountingAccountMap;
  xero: AccountingAccountMap;
}

export interface AccountingEntry {
  transactionId: string;
  date: string;
  account: string;
  amount: string;
  description: string;
  reference: string;
  currency: string;
}

/**
 * Filters accepted by an export. Kept intentionally loose so the
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
export interface ExportsSource {
  /**
   * Stream rows for a resource matching the filters in batches. Implementations must
   * yield plain objects; the exporter serialises them to the requested format.
   */
  streamRows(
    resource: ExportType,
    filters: ExportFilters,
    batchSize: number,
  ): AsyncIterable<Record<string, unknown>[]>;
  getAccountMappings?(merchantId: string): Promise<AccountingAccountMappings | null>;
  saveAccountMappings?(
    merchantId: string,
    mappings: AccountingAccountMappings,
  ): Promise<AccountingAccountMappings>;
}

export class DatabaseExportsSource implements ExportsSource {
  constructor(private readonly dataSource: DataSource) {}

  async getAccountMappings(
    merchantId: string,
  ): Promise<AccountingAccountMappings | null> {
    const rows = await this.dataSource.query(
      'SELECT "mappings" FROM "merchant_account_mappings" WHERE "merchantId" = $1',
      [merchantId],
    );
    return rows[0]?.mappings ?? null;
  }

  async saveAccountMappings(
    merchantId: string,
    mappings: AccountingAccountMappings,
  ): Promise<AccountingAccountMappings> {
    const rows = await this.dataSource.query(
      `INSERT INTO "merchant_account_mappings" ("merchantId", "mappings")
       VALUES ($1, $2::jsonb)
       ON CONFLICT ("merchantId") DO UPDATE
       SET "mappings" = EXCLUDED."mappings", "updatedAt" = now()
       RETURNING "mappings"`,
      [merchantId, JSON.stringify(mappings)],
    );
    return rows[0].mappings as AccountingAccountMappings;
  }

  async *streamRows(
    resource: ExportType,
    filters: ExportFilters,
    batchSize: number,
  ): AsyncIterable<Record<string, unknown>[]> {
    const merchantId = filters.merchantId;
    if (typeof merchantId !== 'string' || merchantId.length === 0) {
      throw new BadRequestException('A merchant ID is required for exports');
    }

    if (isAccountingExport(resource)) {
      yield* this.streamAccountingRows(filters, batchSize, merchantId);
      return;
    }

    const queries: Record<StandardExportType, { select: string; from: string; alias: string; currency: boolean; status: boolean }> = {
      payments: {
        select: 'p."id", p."merchantId", p."amount", p."currency", p."status", p."createdAt"',
        from: '"payments" p', alias: 'p', currency: true, status: true,
      },
      customers: {
        select: 'c."id", c."merchantId", c."email", c."name", c."phone", c."createdAt", c."updatedAt"',
        from: '"customers" c', alias: 'c', currency: false, status: false,
      },
      invoices: {
        select: 'i."id", i."merchantId", i."number", i."customerEmail", i."customerName", i."currency", i."subtotal", i."taxRate", i."taxAmount", i."total", i."dueDate", i."status", i."paymentId", i."createdAt", i."updatedAt"',
        from: '"invoices" i', alias: 'i', currency: true, status: true,
      },
      refunds: {
        select: 'r."id", r."paymentId", r."amount", r."reason", r."reasonCode", r."initiatedBy", r."createdAt"',
        from: '"refunds" r JOIN "payments" p ON p."id" = r."paymentId"', alias: 'r', currency: true, status: false,
      },
      ledger: {
        select:
          'l."id", l."createdAt", l."currency", l."account", l."amount", l."referenceType", l."referenceId", l."transactionId"',
        from: '"ledger_entries" l',
        alias: 'l',
        currency: true,
        status: false,
      },
    };
    const query = queries[resource];
    const conditions = [resource === 'refunds' ? 'p."merchantId" = $1' : `${query.alias}."merchantId" = $1`];
    const params: unknown[] = [merchantId];

    if (resource === 'customers') conditions.push('c."deletedAt" IS NULL');
    if (filters.from) {
      params.push(filters.from);
      conditions.push(`${query.alias}."createdAt" >= $${params.length}`);
    }
    if (filters.to) {
      params.push(filters.to);
      conditions.push(`${query.alias}."createdAt" < $${params.length}`);
    }
    if (query.status && typeof filters.status === 'string') {
      params.push(filters.status);
      conditions.push(`${query.alias}."status" = $${params.length}`);
    }
    if (query.currency && typeof filters.currency === 'string') {
      params.push(filters.currency);
      const currencyAlias =
        resource === 'invoices' ? 'i' : resource === 'ledger' ? 'l' : 'p';
      conditions.push(`${currencyAlias}."currency" = $${params.length}`);
    }

    const orderAlias = query.alias;
    const sql = `SELECT ${query.select}
                   FROM ${query.from}
                  WHERE ${conditions.join(' AND ')}
                  ORDER BY ${orderAlias}."createdAt" ASC, ${orderAlias}."id" ASC
                  LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    let offset = 0;
    while (true) {
      const rows: Record<string, unknown>[] = await this.dataSource.query(sql, [...params, batchSize, offset]);
      if (rows.length === 0) return;
      yield rows;
      offset += rows.length;
      if (rows.length < batchSize) return;
    }
  }

  private async *streamAccountingRows(
    filters: ExportFilters,
    batchSize: number,
    merchantId: string,
  ): AsyncIterable<Record<string, unknown>[]> {
    const union = `
        SELECT p."id"::text AS "id", p."createdAt" AS "date", 'PAYMENT' AS "type",
               COALESCE(p."externalReference", p."id"::text) AS "reference",
               COALESCE(p."description", 'Payment') AS "description",
               p."amount"::text AS "amount", COALESCE(p."feeAmount", 0)::text AS "feeAmount",
               COALESCE(NULLIF(p."netAmount", 0), p."amount" - p."feeAmount")::text AS "netAmount",
               p."currency" AS "currency", p."status"::text AS "status"
          FROM "payments" p
         WHERE p."merchantId" = $1 AND p."status" IN ('COMPLETED', 'REFUNDED', 'PARTIALLY_REFUNDED')
        UNION ALL
        SELECT r."id"::text, r."createdAt", 'REFUND',
               r."id"::text, COALESCE(r."reason", 'Refund'),
               r."amount"::text, '0', '0',
               p."currency", 'COMPLETED'
          FROM "refunds" r
          JOIN "payments" p ON p."id" = r."paymentId"
         WHERE p."merchantId" = $1
        UNION ALL
        SELECT py."id"::text, py."createdAt", 'PAYOUT',
               py."reference", COALESCE(py."memo", 'Payout'),
               py."amount"::text, '0', '0',
               py."currency", py."status"::text
          FROM "payouts" py
         WHERE py."merchantId" = $1 AND py."status" = 'COMPLETED'
    `;
    const conditions = ['1 = 1'];
    const params: unknown[] = [merchantId];
    if (filters.from) {
      params.push(filters.from);
      conditions.push(`accounting."date" >= $${params.length}`);
    }
    if (filters.to) {
      params.push(filters.to);
      conditions.push(`accounting."date" < $${params.length}`);
    }
    if (typeof filters.status === 'string') {
      params.push(filters.status);
      conditions.push(`accounting."status" = $${params.length}`);
    }
    if (typeof filters.currency === 'string') {
      params.push(filters.currency);
      conditions.push(`accounting."currency" = $${params.length}`);
    }

    const sql = `SELECT * FROM (${union}) accounting
                    WHERE ${conditions.join(' AND ')}
                    ORDER BY accounting."date" ASC, accounting."id" ASC, accounting."type" ASC
                    LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    let offset = 0;
    while (true) {
      const rows: Record<string, unknown>[] = await this.dataSource.query(sql, [
        ...params,
        batchSize,
        offset,
      ]);
      if (rows.length === 0) return;
      yield rows;
      offset += rows.length;
      if (rows.length < batchSize) return;
    }
  }
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
  source?: ExportsSource;
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

export const EXPORT_COLUMNS: Record<ExportType, string[]> = {
  payments: ['id', 'merchantId', 'amount', 'currency', 'status', 'createdAt'],
  customers: ['id', 'merchantId', 'email', 'name', 'phone', 'createdAt', 'updatedAt'],
  invoices: [
    'id',
    'merchantId',
    'number',
    'customerEmail',
    'customerName',
    'currency',
    'subtotal',
    'taxRate',
    'taxAmount',
    'total',
    'dueDate',
    'status',
    'paymentId',
    'createdAt',
    'updatedAt',
  ],
  refunds: [
    'id',
    'paymentId',
    'amount',
    'reason',
    'reasonCode',
    'initiatedBy',
    'createdAt',
  ],
  ledger: [
    'id',
    'createdAt',
    'currency',
    'account',
    'amount',
    'referenceType',
    'referenceId',
    'transactionId',
  ],
  quickbooks_iif: [],
  quickbooks_csv: [],
  xero_csv: [],
};

const ACCOUNTING_COLUMNS: Record<
  Exclude<ExportType, 'payments' | 'customers' | 'invoices' | 'refunds' | 'ledger'>,
  string[]
> = {
  quickbooks_iif: [],
  quickbooks_csv: [
    'Journal No.',
    'Journal Date',
    'Account Name',
    'Debits',
    'Credits',
    'Description',
    'Name',
  ],
  xero_csv: [
    '*Narration',
    '*Date',
    '*AccountCode',
    '*TaxRate',
    '*Amount',
    '*Description',
    '*TrackingName1',
    '*TrackingOption1',
    '*TrackingName2',
    '*TrackingOption2',
    '*Currency',
  ],
};

const ACCOUNTING_TYPES: ReadonlySet<ExportType> = new Set([
  'quickbooks_iif',
  'quickbooks_csv',
  'xero_csv',
]);

function isAccountingExport(
  type: ExportType,
): type is keyof typeof ACCOUNTING_COLUMNS {
  return ACCOUNTING_TYPES.has(type);
}

export function buildAccountingEntries(
  rows: Record<string, unknown>[],
  mappings: AccountingAccountMap,
): AccountingEntry[] {
  const entries: AccountingEntry[] = [];
  for (const row of rows) {
    const amount = String(row.amount ?? '0');
    const feeAmount = String(row.feeAmount ?? '0');
    const dateValue = row.date instanceof Date ? row.date.toISOString() : String(row.date ?? '');
    const date = dateValue.slice(0, 10);
    const description = String(row.description ?? '');
    const reference = String(row.reference ?? row.id ?? '');
    const currency = String(row.currency ?? '');
    const type = String(row.type ?? '').toUpperCase();
    const transactionId = String(row.id ?? reference);
    const add = (account: string, value: string, suffix: string) => {
      entries.push({
        transactionId,
        date,
        account,
        amount: value,
        description: suffix ? `${description} (${suffix})` : description,
        reference,
        currency,
      });
    };

    if (type === 'PAYMENT') {
      const netAmount = String(row.netAmount ?? amount);
      add(mappings.clearing, netAmount, 'net payment');
      if (!/^-?0+(?:\.0+)?$/.test(feeAmount)) {
        add(mappings.fees, feeAmount, 'processing fee');
      }
      add(mappings.payments, `-${amount}`, 'payment income');
    } else if (type === 'REFUND') {
      add(mappings.refunds, amount, 'refund');
      add(mappings.clearing, `-${amount}`, 'refund settlement');
    } else if (type === 'PAYOUT') {
      add(mappings.payouts, amount, 'payout');
      add(mappings.clearing, `-${amount}`, 'payout settlement');
    }
  }
  return entries;
}

function safeIifCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+@]/.test(text) || (/^-/.test(text) && !/^-\d+(\.\d+)?$/.test(text))) {
    text = `'${text}`;
  }
  return text.replace(/[\t\r\n]/g, ' ');
}

function formatAccountingDate(date: string): string {
  const [year, month, day] = date.slice(0, 10).split('-');
  return `${month}/${day}/${year}`;
}

export function buildQuickBooksIif(entries: AccountingEntry[]): string {
  const lines = [
    '!TRNS\tTRNSTYPE\tDATE\tACCNT\tAMOUNT\tDOCNUM\tMEMO',
    '!SPL\tTRNSTYPE\tDATE\tACCNT\tAMOUNT\tDOCNUM\tMEMO',
    '!ENDTRNS\t',
  ];
  const groups = new Map<string, AccountingEntry[]>();
  for (const entry of entries) {
    const group = groups.get(entry.transactionId) ?? [];
    group.push(entry);
    groups.set(entry.transactionId, group);
  }
  for (const group of groups.values()) {
    group.forEach((entry, index) => {
      const date = formatAccountingDate(entry.date);
      const memo = `${entry.description} [${entry.currency}]`;
      const recordType = index === 0 ? 'TRNS' : 'SPL';
      lines.push(
        `${recordType}\tGENERAL JOURNAL\t${date}\t${safeIifCell(entry.account)}\t${safeIifCell(entry.amount)}\t${safeIifCell(entry.reference)}\t${safeIifCell(memo)}`,
      );
    });
    lines.push('ENDTRNS');
  }
  return lines.join('\n') + '\n';
}

export function buildQuickBooksCsv(entries: AccountingEntry[]): string {
  const rows = entries.map((entry) => {
    const isCredit = entry.amount.startsWith('-');
    const absoluteAmount = isCredit ? entry.amount.slice(1) : entry.amount;
    return {
      'Journal No.': entry.transactionId,
      'Journal Date': formatAccountingDate(entry.date),
      'Account Name': entry.account,
      Debits: isCredit ? '' : absoluteAmount,
      Credits: isCredit ? absoluteAmount : '',
      Description: `${entry.description} [${entry.currency}] (${entry.reference})`,
      Name: '',
    };
  });
  return buildCsv(ACCOUNTING_COLUMNS.quickbooks_csv, rows);
}

export function buildXeroCsv(entries: AccountingEntry[]): string {
  const rows = entries.map((entry) => ({
    '*Narration': entry.transactionId,
    '*Date': entry.date,
    '*AccountCode': entry.account,
    '*TaxRate': 'No VAT',
    '*Amount': entry.amount,
    '*Description': `${entry.description} [${entry.currency}] (${entry.reference})`,
    '*TrackingName1': '',
    '*TrackingOption1': '',
    '*TrackingName2': '',
    '*TrackingOption2': '',
    '*Currency': entry.currency,
  }));
  return buildCsv(ACCOUNTING_COLUMNS.xero_csv, rows);
}

export function sanitizeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let str = value instanceof Date ? value.toISOString() : String(value);
  // Plain signed numbers (e.g. ledger deltas like -92.50) cannot execute as formulas.
  if (/^[=+\-@]/.test(str) && !/^-\d+(\.\d+)?$/.test(str)) str = `'${str}`;
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

/**
 * Serialise rows to CSV using the given column order, header row first.
 */
export function buildCsv(columns: string[], rows: object[]): string {
  const lines = [columns.map(sanitizeCsvCell).join(',')];
  for (const row of rows) {
    const record = row as Record<string, unknown>;
    lines.push(
      columns.map((column) => sanitizeCsvCell(record[column])).join(','),
    );
  }
  return lines.join('\n') + '\n';
}

/**
 * ExportsService owns the lifecycle of asynchronous resource exports:
 *
 *  - POST /v1/exports enqueues a job and returns its id.
 *  - GET  /v1/exports/:id returns status for the owner.
 *  - GET  /v1/exports/:id/download streams the file for a valid signed link.
 *
 * The heavy lifting runs in a BullMQ worker so the request thread never builds
 * the file. Rows are streamed in batches to keep memory bounded regardless of
  * how many records match the filters.
 */
@Injectable()
export class ExportsService {
  private readonly logger = new Logger(ExportsService.name);
  private readonly records = new Map<string, ExportRecord>();
  private readonly queue: Queue;
  private readonly worker: Worker;
  private readonly storage: ExportStorageAdapter;
  private readonly source?: ExportsSource;
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
    format?: ExportFormat;
    filters?: ExportFilters;
    ownerId: string;
  }): Promise<ExportJobView> {
    if (!Object.hasOwn(EXPORT_COLUMNS, input.type)) {
      throw new BadRequestException(`Unsupported export type: ${input.type}`);
    }
    const accountingFormat: ExportFormat =
      input.type === 'quickbooks_iif' ? 'iif' : 'csv';
    const format = input.format ?? (isAccountingExport(input.type) ? accountingFormat : 'csv');
    if (format !== 'csv' && format !== 'pdf' && format !== 'iif') {
      throw new BadRequestException(`Unsupported export format: ${format}`);
    }
    if (isAccountingExport(input.type) && format !== accountingFormat) {
      throw new BadRequestException(
        `Export type ${input.type} requires the ${accountingFormat} format`,
      );
    }
    if (!isAccountingExport(input.type) && format === 'iif') {
      throw new BadRequestException('The iif format is only supported for accounting exports');
    }

    let accountMappings: AccountingAccountMappings | undefined;
    if (isAccountingExport(input.type)) {
      accountMappings = await this.getAccountMappings(input.ownerId);
      if (!accountMappings) {
        throw new BadRequestException(
          'Configure accounting account mappings before creating this export',
        );
      }
    }

    const now = new Date().toISOString();
    const record: ExportRecord = {
      id: randomUUID(),
      type: input.type,
      format,
      filters: {
        ...input.filters,
        ...(accountMappings ? { accountMappings } : {}),
        merchantId: input.ownerId,
      },
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

  async getAccountMappings(
    merchantId: string,
  ): Promise<AccountingAccountMappings | null> {
    if (!this.source?.getAccountMappings) {
      throw new Error('Accounting account mappings are not configured');
    }
    return this.source.getAccountMappings(merchantId);
  }

  async saveAccountMappings(
    merchantId: string,
    mappings: AccountingAccountMappings,
  ): Promise<AccountingAccountMappings> {
    if (!mappings || typeof mappings !== 'object') {
      throw new BadRequestException('Accounting account mappings are required');
    }
    const keys: (keyof AccountingAccountMap)[] = [
      'payments',
      'fees',
      'refunds',
      'payouts',
      'clearing',
    ];
    const normalizeMap = (platform: keyof AccountingAccountMappings) => {
      const current = mappings[platform];
      if (!current || typeof current !== 'object') {
        throw new BadRequestException(`The ${platform} account mappings are required`);
      }
      const normalized: AccountingAccountMap = {
        payments: '',
        fees: '',
        refunds: '',
        payouts: '',
        clearing: '',
      };
      for (const key of keys) {
        const value = current[key];
        if (typeof value !== 'string' || value.trim().length === 0 || value.trim().length > 100) {
          throw new BadRequestException(
            `Account mapping "${platform}.${key}" must be a non-empty string of at most 100 characters`,
          );
        }
        normalized[key] = value.trim();
      }
      return normalized;
    };
    const normalized: AccountingAccountMappings = {
      quickbooks: normalizeMap('quickbooks'),
      xero: normalizeMap('xero'),
    };
    if (!this.source?.saveAccountMappings) {
      throw new Error('Accounting account mappings are not configured');
    }
    return this.source.saveAccountMappings(merchantId, normalized);
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
      fileName: `${record.type}-export-${record.id}.${record.format}`,
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
  buildDownloadUrl(id: string, ownerId: string): string {
    const record = this.requireOwned(id, ownerId);
    const expiresAt = Date.parse(record.expiresAt ?? new Date().toISOString());
    const token = this.signDownloadToken(record.id, record.ownerId, expiresAt);
    const base = this.publicBaseUrl.replace(/\/$/, '');
    return `${base}/v1/exports/${record.id}/download?expires=${expiresAt}&token=${token}`;
  }

  async openDownload(
    ownerId: string,
    id: string,
    expires: number,
    token: string,
  ): Promise<{ stream: NodeJS.ReadableStream; filename: string; contentType: string }> {
    const record = this.requireOwned(id, ownerId);
    if (!Number.isFinite(expires) || Date.now() >= expires || !record.expiresAt || Date.parse(record.expiresAt) !== expires) {
      throw new ForbiddenException('Download link has expired');
    }
    if (!this.verifyDownloadToken(id, ownerId, expires, token)) {
      throw new ForbiddenException('Invalid download token');
    }
    if (record.status !== 'completed' || !record.filePath) {
      throw new BadRequestException('Export is not ready for download');
    }
    return {
      stream: createReadStream(record.filePath),
      filename: `${record.type}-export-${record.id}.${record.format}`,
      contentType:
        record.format === 'csv'
          ? 'text/csv; charset=utf-8'
          : record.format === 'iif'
            ? 'application/x-iif'
            : 'application/pdf',
    };
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
      throw new Error('No export source configured');
    }

    const chunks: string[] = [];
    const accountingEntries: AccountingEntry[] = [];
    const isAccounting = isAccountingExport(record.type);
    let rowCount = 0;
    const header = EXPORT_COLUMNS[record.type];
    if (record.format === 'csv' && !isAccounting) {
      chunks.push(header.map(sanitizeCsvCell).join(',') + '\n');
    }

    for await (const batch of this.source.streamRows(record.type, record.filters, this.batchSize)) {
      if (isAccounting) {
        const mappings = record.filters.accountMappings as
          | AccountingAccountMappings
          | undefined;
        if (!mappings) {
          throw new Error('Accounting account mappings are missing from the export job');
        }
        const platformMappings =
          record.type === 'xero_csv' ? mappings.xero : mappings.quickbooks;
        accountingEntries.push(...buildAccountingEntries(batch, platformMappings));
        rowCount += batch.length;
        continue;
      }
      for (const row of batch) {
        if (record.format === 'csv') {
          chunks.push(header.map((column) => sanitizeCsvCell(row[column])).join(',') + '\n');
        } else {
          chunks.push(JSON.stringify(row));
        }
        rowCount += 1;
      }
    }

    let body = record.format === 'csv' ? chunks.join('') : chunks.join('\n');
    if (record.type === 'quickbooks_iif') {
      body = buildQuickBooksIif(accountingEntries);
    } else if (record.type === 'quickbooks_csv') {
      body = buildQuickBooksCsv(accountingEntries);
    } else if (record.type === 'xero_csv') {
      body = buildXeroCsv(accountingEntries);
    }
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
      view.downloadUrl = this.buildDownloadUrl(record.id, record.ownerId);
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

}
