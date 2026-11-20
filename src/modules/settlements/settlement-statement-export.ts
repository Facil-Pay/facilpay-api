import PDFDocument from 'pdfkit';
import type PDFKitType from 'pdfkit';

/** Escapes a CSV cell and neutralises spreadsheet formula injection. */
export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  const safe =
    /^[=+\-@\t\r]/.test(text) && !Number.isFinite(Number(text))
      ? `'${text}`
      : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export interface SettlementStatementPdfConversion {
  settlementAsset?: string | null;
  sourceAsset?: string | null;
  sourceAmount?: number | string | null;
  destAmount?: number | string | null;
  conversionRate?: number | string | null;
  slippagePercent?: number | string | null;
  conversionFee?: number | string | null;
  conversionTransactionHash?: string | null;
}

export interface SettlementStatementPdfOptions {
  merchant: string;
  period: string;
  currency: string;
  transactionHash?: string | null;
  settlementAmount: number;
  conversion?: SettlementStatementPdfConversion | null;
}

export interface SettlementStatementRowLike {
  paymentId: string;
  reference: string | null;
  gross: number;
  fee: number;
  net: number;
  refunds: number;
  adjustments: number;
}

export function createSettlementStatementPdfDocument(
  options: SettlementStatementPdfOptions,
): PDFKitType.PDFDocument {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  doc.fontSize(16).text('Settlement Statement');
  doc.moveDown(0.5).fontSize(10);
  doc.text(`Merchant: ${options.merchant}`);
  doc.text(`Period: ${options.period}`);
  doc.text(`Currency: ${options.currency}`);
  if (options.transactionHash)
    doc.text(`Transaction hash: ${options.transactionHash}`);
  doc.text(`Settlement amount: ${options.settlementAmount.toFixed(2)}`);

  const conversion = options.conversion;
  if (conversion?.settlementAsset) {
    doc.moveDown(0.5).fontSize(12).text('Asset conversion');
    doc.fontSize(10);
    doc.text(`Settlement asset: ${conversion.settlementAsset}`);
    if (conversion.sourceAsset)
      doc.text(`Source asset: ${conversion.sourceAsset}`);
    if (
      conversion.sourceAmount !== undefined &&
      conversion.sourceAmount !== null
    ) {
      doc.text(`Source amount: ${conversion.sourceAmount}`);
    }
    if (conversion.destAmount !== undefined && conversion.destAmount !== null) {
      doc.text(`Converted amount: ${conversion.destAmount}`);
    }
    if (
      conversion.conversionRate !== undefined &&
      conversion.conversionRate !== null
    ) {
      doc.text(`Conversion rate: ${conversion.conversionRate}`);
    }
    if (
      conversion.slippagePercent !== undefined &&
      conversion.slippagePercent !== null
    ) {
      doc.text(`Slippage: ${conversion.slippagePercent}%`);
    }
    if (
      conversion.conversionFee !== undefined &&
      conversion.conversionFee !== null
    ) {
      doc.text(`Conversion fee: ${conversion.conversionFee} XLM`);
    }
    if (conversion.conversionTransactionHash) {
      doc.text(
        `Conversion transaction: ${conversion.conversionTransactionHash}`,
      );
    }
  }
  doc.moveDown();
  return doc;
}

export function writeSettlementStatementPdfTable(
  doc: PDFKitType.PDFDocument,
  rows: SettlementStatementRowLike[],
  totals: SettlementStatementRowLike,
): void {
  const columns = [
    { label: 'Payment', x: 50, width: 130 },
    { label: 'Reference', x: 180, width: 100 },
    { label: 'Gross', x: 280, width: 60 },
    { label: 'Fee', x: 340, width: 60 },
    { label: 'Net', x: 400, width: 60 },
    { label: 'Refunds', x: 460, width: 60 },
    { label: 'Adjustments', x: 520, width: 70 },
  ];

  doc.fontSize(9);
  for (const column of columns) {
    doc.text(column.label, column.x, doc.y, {
      width: column.width,
      continued: false,
    });
  }
  doc.moveDown();

  for (const row of [...rows, totals]) {
    const values = [
      row.paymentId,
      row.reference ?? '',
      row.gross.toFixed(2),
      row.fee.toFixed(2),
      row.net.toFixed(2),
      row.refunds.toFixed(2),
      row.adjustments.toFixed(2),
    ];
    const y = doc.y;
    values.forEach((value, index) => {
      doc.text(String(value).slice(0, 30), columns[index].x, y, {
        width: columns[index].width,
        continued: false,
      });
    });
    doc.moveDown();
  }
}
