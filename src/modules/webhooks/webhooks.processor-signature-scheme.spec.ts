import { createHmac, generateKeyPairSync } from 'crypto';
import { of } from 'rxjs';
import { WebhooksProcessor } from './webhooks.processor';
import { WebhookDelivery } from './entities/webhook-delivery.entity';
import { verifyEd25519Signature } from './webhook-signing';

describe('WebhooksProcessor signature schemes', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const payload = { event: 'payment.completed', data: { id: 'p1' } };
  const job = { data: { deliveryId: 'd1', endpointId: 'e1', payload }, attemptsMade: 0, opts: { attempts: 6 } } as any;
  const logger = { child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) };

  function build(endpoint: Record<string, unknown>) {
    const http = { post: jest.fn().mockReturnValue(of({ status: 200, data: 'ok' })) };
    const keys = { getSigningKey: jest.fn().mockResolvedValue({ kid: 'whk_test', privateKey }) };
    const processor = new WebhooksProcessor(
      { findOne: jest.fn().mockResolvedValue(new WebhookDelivery()), save: jest.fn() } as any,
      { findOne: jest.fn().mockResolvedValue({ id: 'e1', url: 'https://merchant.example/hook', ...endpoint }), update: jest.fn() } as any,
      http as any,
      { recordDeliverySuccess: jest.fn(), recordDeliveryFailure: jest.fn() } as any,
      logger as any,
      undefined,
      keys as any,
    );
    return { processor, http, keys };
  }

  it('keeps HMAC-SHA256 signing for endpoints without a scheme (existing endpoints)', async () => {
    const { processor, http, keys } = build({ secret: 'whsec_test' });
    await processor.process(job);
    const headers = http.post.mock.calls[0][2].headers;
    expect(headers['X-FacilPay-Signature']).toBe(
      createHmac('sha256', 'whsec_test').update(JSON.stringify(payload)).digest('hex'),
    );
    expect(keys.getSigningKey).not.toHaveBeenCalled();
  });

  it('signs ed25519 endpoints with the platform key and kid', async () => {
    const { processor, http } = build({ secret: 'whsec_test', signatureScheme: 'ed25519' });
    await processor.process(job);
    const header: string = http.post.mock.calls[0][2].headers['X-FacilPay-Signature'];
    expect(header).toMatch(/^t=\d+,kid=whk_test,ed25519=/);
    expect(verifyEd25519Signature(header, JSON.stringify(payload), { whk_test: publicPem })).toBe(true);
  });
});
