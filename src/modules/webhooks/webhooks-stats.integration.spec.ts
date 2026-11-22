import { DataSource, QueryRunner } from 'typeorm';
import { WebhookEndpoint } from './entities/webhook-endpoint.entity';
import { WebhookDelivery } from './entities/webhook-delivery.entity';
import { WebhooksService } from './webhooks.service';

// Uses a connection-local temporary table; no production tables are changed.
const databaseUrl = process.env.TEST_DATABASE_URL;
(databaseUrl ? describe : describe.skip)('Webhook stats on seeded PostgreSQL data', () => {
  let source: DataSource;
  let runner: QueryRunner;
  beforeAll(async () => {
    source = await new DataSource({ type: 'postgres', url: databaseUrl, entities: [WebhookEndpoint, WebhookDelivery], synchronize: false }).initialize();
    runner = source.createQueryRunner();
    await runner.connect();
    await runner.query('CREATE TEMP TABLE webhook_deliveries ("endpointId" text, "lastAttemptAt" timestamptz, "latencyMs" integer, status text)');
  });
  afterAll(async () => {
    if (runner) {
      await runner.query('DROP TABLE IF EXISTS pg_temp.webhook_deliveries');
      await runner.release();
    }
    if (source?.isInitialized) await source.destroy();
  });
  it('computes percentiles, success rate and failures in both windows', async () => {
    const now = Date.parse('2026-10-19T12:00:00Z');
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    try {
      for (const [endpointId, hoursAgo, latency, status] of [
        ['e1', 1, 100, 'success'], ['e1', 2, 200, 'success'],
        ['e1', 3, 300, 'failed'], ['e1', 4, 400, 'dead-letter'],
        ['e1', 72, 500, 'success'], ['e1', 72, 600, 'failed'],
        ['e1', 192, 700, 'failed'], ['other', 1, 1000, 'failed'],
        ['e1', 1, 999, 'pending'], ['e1', -1, 999, 'failed'],
      ] as const) {
        await runner.query('INSERT INTO webhook_deliveries VALUES ($1, $2, $3, $4)', [endpointId, new Date(now - hoursAgo * 3600000), latency, status]);
      }
      const service = new WebhooksService({ findOneBy: async () => ({ id: 'e1', merchantId: 'm1' }) } as any, runner.manager.getRepository(WebhookDelivery), {} as any, {} as any, {} as any, { get: (_key: string, fallback: unknown) => fallback } as any, {} as any, { child: () => ({}) } as any);
      const stats = await service.getStats('e1', 'm1') as any;
      expect(stats.windows['24h']).toMatchObject({ total: 4, succeeded: 2, failures: 2, successRate: 0.5, p50LatencyMs: 250 });
      expect(stats.windows['24h'].p95LatencyMs).toBeCloseTo(385);
      expect(stats.windows['7d']).toMatchObject({ total: 6, succeeded: 3, failures: 3, successRate: 0.5, p50LatencyMs: 350 });
      expect(stats.windows['7d'].p95LatencyMs).toBeCloseTo(575);
    } finally {
      clock.mockRestore();
    }
  });
});
