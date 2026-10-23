import { Invoice } from '../../invoices/invoice.entity';

/**
 * Builds the webhook `data` payload for invoice.* events.
 *
 * The shape mirrors the persisted invoice state at the moment of dispatch so
 * receivers can act on the payload without a follow-up API call.
 */
export function serializeInvoice(invoice: Invoice): Record<string, any> {
  return {
    invoiceId: invoice.id,
    number: formatInvoiceNumber(invoice.number),
    customerEmail: invoice.customerEmail,
    customerName: invoice.customerName,
    currency: invoice.currency,
    subtotal: String(invoice.subtotal),
    taxRate: String(invoice.taxRate),
    taxAmount: String(invoice.taxAmount),
    total: String(invoice.total),
    dueDate: invoice.dueDate instanceof Date ? invoice.dueDate.toISOString() : invoice.dueDate,
    status: invoice.status,
    paymentId: invoice.paymentId ?? null,
    lineItems: (invoice.lineItems ?? []).map((item) => ({
      description: item.description,
      quantity: String(item.quantity),
      unitPrice: String(item.unitPrice),
      amount: String(item.amount),
      productId: item.productId ?? null,
    })),
  };
}

function formatInvoiceNumber(number: number): string {
  return `INV-${String(number).padStart(6, '0')}`;
}
