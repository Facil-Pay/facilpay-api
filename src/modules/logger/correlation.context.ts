import { AsyncLocalStorage } from 'node:async_hooks';

interface CorrelationStore {
  correlationId: string;
}

export const correlationStore = new AsyncLocalStorage<CorrelationStore>();

export function getCorrelationId(): string | undefined {
  return correlationStore.getStore()?.correlationId;
}
