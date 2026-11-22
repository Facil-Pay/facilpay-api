import { Customer } from '../../customers/customer.entity';

/**
 * Builds the webhook `data` payload for customer.* events.
 *
 * The shape mirrors the persisted customer state at the moment of dispatch so
 * receivers can sync to a CRM without a follow-up API call.
 */
export function serializeCustomer(customer: Customer): Record<string, any> {
  return {
    customerId: customer.id,
    merchantId: customer.merchantId,
    email: customer.email,
    name: customer.name,
    phone: customer.phone,
    metadata: customer.metadata ?? null,
    createdAt: customer.createdAt instanceof Date ? customer.createdAt.toISOString() : customer.createdAt,
    updatedAt: customer.updatedAt instanceof Date ? customer.updatedAt.toISOString() : customer.updatedAt,
  };
}
