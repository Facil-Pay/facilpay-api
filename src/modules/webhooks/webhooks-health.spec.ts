import { WebhooksService } from './webhooks.service';
import { WebhooksProcessor } from './webhooks.processor';
import { WebhookDeliveryStatus } from './entities/webhook-delivery.entity';
import { of, throwError } from 'rxjs';

describe('Webhook endpoint health', () => {
  let service: WebhooksService;
  let repo: any;
  let query: any;
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-19T12:00:00Z'));
    repo = { findOneBy: jest.fn().mockResolvedValue({ id: 'e1', merchantId: 'm1' }) };
    query = {};
    for (const name of ['select', 'addSelect', 'where', 'andWhere']) query[name] = jest.fn().mockReturnValue(query);
    query.getRawOne = jest.fn().mockResolvedValueOnce({ total: '4', succeeded: '3', failures: '1', p50: '150', p95: '285' }).mockResolvedValue({ total: '8', succeeded: '6', failures: '2', p50: '200', p95: '485' });
    service = new WebhooksService(repo, { createQueryBuilder: () => query } as any, {} as any, {} as any, {} as any, { get: (_key: string, fallback: unknown) => fallback } as any, {} as any, { child: () => ({}) } as any);
  });
  afterEach(() => jest.useRealTimers());
  it('rejects reserved headers on both endpoint creation and update', async () => {
    await expect(service.create({ url: 'https://example.com', events: ['payment.created'], headers: { HOST: 'evil' } }, 'm1')).rejects.toThrow();
    await expect(service.update('e1', { headers: { 'X-FacilPay-Signature': 'override' } }, 'm1')).rejects.toThrow();
  });
  it('returns numeric window aggregates and reuses results for 60 seconds', async () => {
    const stats = await service.getStats('e1', 'm1');
    expect(stats).toEqual({ endpointId: 'e1', windows: {
      '24h': { total: 4, succeeded: 3, failures: 1, successRate: 0.75, p50LatencyMs: 150, p95LatencyMs: 285 },
      '7d': { total: 8, succeeded: 6, failures: 2, successRate: 0.75, p50LatencyMs: 200, p95LatencyMs: 485 },
    } });
    expect(query.andWhere).toHaveBeenCalledWith('delivery.lastAttemptAt >= :since', { since: new Date('2026-10-18T12:00:00Z') });
    expect(query.andWhere).toHaveBeenCalledWith('delivery.lastAttemptAt >= :since', { since: new Date('2026-10-12T12:00:00Z') });
    await service.getStats('e1', 'm1');
    expect(query.getRawOne).toHaveBeenCalledTimes(2);
    await expect(service.getStats('e1', 'other')).rejects.toThrow();
    jest.advanceTimersByTime(60000);
    await service.getStats('e1', 'm1');
    expect(query.getRawOne).toHaveBeenCalledTimes(4);
  });
  it('represents empty windows without NaN or invented latency', async () => {
    query.getRawOne.mockReset().mockResolvedValue({ total: '0', succeeded: '0', failures: '0', p50: null, p95: null });
    expect(await service.getStats('e1', 'm1')).toMatchObject({ windows: { '24h': { successRate: 0, p50LatencyMs: null, p95LatencyMs: null } } });
  });
  it('rejects missing endpoints before querying deliveries', async () => {
    repo.findOneBy.mockResolvedValue(null);
    await expect(service.getStats('missing', 'm1')).rejects.toThrow();
    expect(query.getRawOne).not.toHaveBeenCalled();
  });
});

describe('Custom headers on delivery', () => {
  it.each([true, false])('sends headers and records latency on success=%s', async success => {
    const delivery: any = {};
    const deliveryRepo = { findOne: jest.fn().mockResolvedValue(delivery), save: jest.fn() };
    const endpointRepo = { findOne: jest.fn().mockResolvedValue({ url: 'https://example.com', secret: 'secret', headers: { Authorization: 'Bearer gateway-token' } }) };
    const http = { post: jest.fn().mockReturnValue(success ? of({ status: 200 }) : throwError(() => new Error('timeout'))) };
    const service = { recordDeliverySuccess: jest.fn(), recordDeliveryFailure: jest.fn() };
    const logger = { child: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }) };
    const processor = new WebhooksProcessor(deliveryRepo as any, endpointRepo as any, http as any, service as any, logger as any);
    const work = processor.process({ data: { deliveryId: 'd1', endpointId: 'e1', payload: { event: 'test' } }, attemptsMade: 0, opts: { attempts: 1 } } as any);
    if (success) await work; else await expect(work).rejects.toThrow('timeout');
    expect(http.post).toHaveBeenCalledWith('https://example.com', { event: 'test' }, expect.objectContaining({ maxRedirects: 0, headers: expect.objectContaining({ Authorization: 'Bearer gateway-token', 'X-FacilPay-Signature': expect.any(String) }) }));
    expect(delivery.latencyMs).toBeGreaterThanOrEqual(0);
    expect(delivery.status).toBe(success ? WebhookDeliveryStatus.SUCCESS : WebhookDeliveryStatus.DEAD_LETTER);
  });
});
