import type PDFKitType from 'pdfkit';
import PDFDocument from 'pdfkit';
import type { Payment } from '../payment.entity';


export type PaymentsRow = Pick<
    Payment,
    | 'id'
    | 'amount'
    | 'currency'
    | 'status'
    | 'externalReference'
    | 'description'
    | 'refundedAmount'
    | 'cancelledAt'
    | 'createdAt'
    | 'updatedAt'
>;

export function csvEscape(value: unknown): string {
    if (value === null || value === undefined) return '';
    let str = String(value);
    // Neutralize formula injection characters: =, +, -, @
    if (/^[=\+\-@]/.test(str)) {
        str = "'" + str;
    }
    // Quote if contains comma, quote, newline, or carriage return
    if (/[",\n\r]/.test(str)) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

export function paymentToCsvRow(p: PaymentsRow): string {
    // Header order must match export endpoint
    return [
        p.id,
        p.amount,
        p.currency,
        p.status,
        p.externalReference,
        p.description,
        p.refundedAmount,
        p.cancelledAt instanceof Date ? p.cancelledAt.toISOString() : p.cancelledAt,
        p.createdAt instanceof Date ? p.createdAt.toISOString() : p.createdAt,
        p.updatedAt instanceof Date ? p.updatedAt.toISOString() : p.updatedAt,
    ]
        .map(csvEscape)
        .join(',');
}

export function writePaymentsPdfTable(
    doc: PDFKitType.PDFDocument,
    payments: PaymentsRow[],
) {

    // Basic, dependency-light table rendering using pdfkit built-ins.
    // For large exports, caller should chunk and call this repeatedly.

    const leftMargin = doc.page.margins.left;
    let y = doc.y;

    const headers = [
        'ID',
        'Amount',
        'Currency',
        'Status',
        'ExternalRef',
        'Description',
        'Refunded',
        'CancelledAt',
        'CreatedAt',
        'UpdatedAt',
    ];

    const colWidths = [
        170,
        70,
        60,
        70,
        110,
        150,
        70,
        95,
        120,
        120,
    ];

    const headerFontSize = 10;
    const rowFontSize = 9;
    const rowHeight = 18;

    doc.fontSize(headerFontSize).font('Helvetica-Bold');

    let x = leftMargin;
    for (let i = 0; i < headers.length; i++) {
        doc.text(headers[i], x, y, { width: colWidths[i], ellipsis: true });
        x += colWidths[i];
    }
    y += rowHeight;

    doc.font('Helvetica');
    doc.fontSize(rowFontSize);

    for (const p of payments) {
        if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
            doc.addPage();
            y = doc.y;

            doc.fontSize(headerFontSize).font('Helvetica-Bold');
            let xh = leftMargin;
            for (let i = 0; i < headers.length; i++) {
                doc.text(headers[i], xh, y, { width: colWidths[i], ellipsis: true });
                xh += colWidths[i];
            }
            y += rowHeight;
            doc.font('Helvetica').fontSize(rowFontSize);
        }

        const values = [
            p.id,
            p.amount,
            p.currency,
            p.status,
            p.externalReference ?? '',
            p.description ?? '',
            p.refundedAmount,
            p.cancelledAt ? (p.cancelledAt instanceof Date ? p.cancelledAt.toISOString() : p.cancelledAt) : '',
            p.createdAt ? (p.createdAt instanceof Date ? p.createdAt.toISOString() : p.createdAt) : '',
            p.updatedAt ? (p.updatedAt instanceof Date ? p.updatedAt.toISOString() : p.updatedAt) : '',
        ];

        let xr = leftMargin;
        for (let i = 0; i < values.length; i++) {
            doc.text(String(values[i] ?? ''), xr, y, {
                width: colWidths[i],
                ellipsis: true,
            });
            xr += colWidths[i];
        }

        y += rowHeight;
    }

    doc.moveTo(leftMargin, y);
}

export function createPaymentsPdfDocument(): PDFKitType.PDFDocument {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });

    doc.font('Helvetica');
    doc.fontSize(14).text('Payments Report', { align: 'left' });
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor('gray').text(`Generated at: ${new Date().toISOString()}`);
    doc.fillColor('black');
    doc.moveDown();
    return doc;
}

