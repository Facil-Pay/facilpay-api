// The real logger pulls in src/tracing.ts, which needs OpenTelemetry packages
// that are not installed everywhere; none of these tests need it.
jest.mock('../logger/logger.service', () => ({
  AppLogger: class AppLogger {},
}));

import { createHmac } from 'crypto';
import { ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Observable, of } from 'rxjs';
import { WebhooksController } from './webhooks.controller';
import { WebhooksProcessor } from './webhooks.processor';
import { WebhooksService } from './webhooks.service';
import { maskEndpoint } from './header-security';
import { RotateWebhookSecretDto } from './dto/rotate-webhook-secret.dto';
import { WebhookEndpoint } from './entities/webhook-endpoint.entity';

const NOW = new Date('2026-10-21T12:00:00.000Z');
const hours = (n: number) => n * 3600_000;

function makeEndpoint(overrides: Partial<WebhookEndpoint> = {}) {
  return Object.assign(new WebhookEndpoint(), {
    id: 'e1',
    merchantId: 'm1',
    url: 'https://merchant.example.com/hook',
    secret: 'whsec_old',
    previousSecret: null,
    previousSecretExpiresAt: null,
    headers: null,
    apiVersion: '2026-09-01',
    ...overrides,
  });
}

describe('webhook secret rotation grace period', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(NOW));
  afterEach(() => jest.useRealTimers());

  describe('WebhooksService.rotateSecret', () => {
    let endpointRepo: { findOneBy: jest.Mock; save: jest.Mock };
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

    const buildService = (configured?: number) => {
      endpointRepo = {
        findOneBy: jest.fn(),
        save: jest.fn((endpoint: WebhookEndpoint) => Promise.resolve(endpoint)),
      };
      const config = {
        get: (key: string, fallback: unknown) =>
          key === 'WEBHOOK_SECRET_GRACE_PERIOD_HOURS' &&
          configured !== undefined
            ? configured
            : fallback,
      };
      return new WebhooksService(
        endpointRepo as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        config as never,
        {} as never,
        { child: () => logger } as never,
      );
    };

    it('keeps the old secret for 24 hours by default', async () => {
      const service = buildService();
      endpointRepo.findOneBy.mockResolvedValue(makeEndpoint());

      const rotated = await service.rotateSecret('e1', 'm1');

      expect(rotated.previousSecret).toBe('whsec_old');
      expect(rotated.previousSecretExpiresAt).toEqual(
        new Date(NOW.getTime() + hours(24)),
      );
      expect(rotated.secret).toMatch(/^whsec_[0-9a-f]{64}$/);
      expect(rotated.secret).not.toBe('whsec_old');
    });

    it('honours an explicit window and the configured default', async () => {
      const explicit = buildService();
      endpointRepo.findOneBy.mockResolvedValue(makeEndpoint());
      expect(
        (await explicit.rotateSecret('e1', 'm1', 2)).previousSecretExpiresAt,
      ).toEqual(new Date(NOW.getTime() + hours(2)));

      const configured = buildService(48);
      endpointRepo.findOneBy.mockResolvedValue(makeEndpoint());
      expect(
        (await configured.rotateSecret('e1', 'm1')).previousSecretExpiresAt,
      ).toEqual(new Date(NOW.getTime() + hours(48)));
    });

    it('switches immediately and discards any open window when the grace period is 0', async () => {
      const service = buildService();
      endpointRepo.findOneBy.mockResolvedValue(
        makeEndpoint({
          previousSecret: 'whsec_older',
          previousSecretExpiresAt: new Date(NOW.getTime() + hours(5)),
        }),
      );

      const rotated = await service.rotateSecret('e1', 'm1', 0);

      expect(rotated.previousSecret).toBeNull();
      expect(rotated.previousSecretExpiresAt).toBeNull();
    });

    it('only ever trusts one previous secret when rotated twice in a row', async () => {
      const service = buildService();
      const endpoint = makeEndpoint();
      endpointRepo.findOneBy.mockResolvedValue(endpoint);

      const first = await service.rotateSecret('e1', 'm1');
      const firstSecret = first.secret;
      const second = await service.rotateSecret('e1', 'm1');

      expect(second.previousSecret).toBe(firstSecret);
      expect(second.previousSecret).not.toBe('whsec_old');
    });

    it('does not rotate an endpoint owned by another merchant', async () => {
      const service = buildService();
      endpointRepo.findOneBy.mockResolvedValue(makeEndpoint());

      await expect(service.rotateSecret('e1', 'other')).rejects.toThrow(
        ForbiddenException,
      );
      expect(endpointRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('WebhooksProcessor signing', () => {
    const body = JSON.stringify({ event: 'payment.completed' });
    const digest = (secret: string) =>
      createHmac('sha256', secret).update(body).digest('hex');

    const build = (endpoint: WebhookEndpoint) => {
      const deliveryRepo = {
        findOne: jest.fn().mockResolvedValue({ id: 'd1' }),
        save: jest.fn(),
      };
      const endpointRepo = {
        findOne: jest.fn().mockResolvedValue(endpoint),
        update: jest.fn().mockResolvedValue(undefined),
      };
      const httpService = {
        post: jest
          .fn<
            Observable<{ status: number }>,
            [string, unknown, { headers: Record<string, string> }]
          >()
          .mockReturnValue(of({ status: 200 })),
      };
      const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
      const processor = new WebhooksProcessor(
        deliveryRepo as never,
        endpointRepo as never,
        httpService as never,
        {
          recordDeliverySuccess: jest.fn(),
          recordDeliveryFailure: jest.fn(),
        } as never,
        { child: () => logger } as never,
      );
      const run = () =>
        processor.process({
          data: {
            deliveryId: 'd1',
            endpointId: 'e1',
            payload: { event: 'payment.completed' },
          },
          attemptsMade: 0,
          opts: { attempts: 6 },
        } as never);
      const signatureHeader = (): string =>
        httpService.post.mock.calls[0][2].headers['X-FacilPay-Signature'];
      return { run, endpointRepo, signatureHeader };
    };

    it('sends one digest per secret during the grace period and both verify', async () => {
      const { run, endpointRepo, signatureHeader } = build(
        makeEndpoint({
          secret: 'whsec_new',
          previousSecret: 'whsec_old',
          previousSecretExpiresAt: new Date(NOW.getTime() + hours(1)),
        }),
      );

      await run();

      const signatures = signatureHeader().split(',');
      expect(signatures).toEqual([digest('whsec_new'), digest('whsec_old')]);
      expect(endpointRepo.update).not.toHaveBeenCalled();
    });

    it('signs with the new secret only after expiry and clears the stored old secret', async () => {
      const { run, endpointRepo, signatureHeader } = build(
        makeEndpoint({
          secret: 'whsec_new',
          previousSecret: 'whsec_old',
          previousSecretExpiresAt: new Date(NOW.getTime() - 1),
        }),
      );

      await run();

      expect(signatureHeader()).toBe(digest('whsec_new'));
      expect(endpointRepo.update).toHaveBeenCalledWith('e1', {
        previousSecret: null,
        previousSecretExpiresAt: null,
      });
    });

    it('still delivers if clearing the expired secret fails', async () => {
      const { run, endpointRepo, signatureHeader } = build(
        makeEndpoint({
          secret: 'whsec_new',
          previousSecret: 'whsec_old',
          previousSecretExpiresAt: new Date(NOW.getTime() - 1),
        }),
      );
      endpointRepo.update.mockRejectedValue(new Error('db down'));

      await expect(run()).resolves.toEqual({ success: true, statusCode: 200 });
      expect(signatureHeader()).toBe(digest('whsec_new'));
    });

    it('keeps a plain single signature for endpoints that were never rotated', async () => {
      const { run, signatureHeader } = build(
        makeEndpoint({ secret: 'whsec_new' }),
      );

      await run();

      expect(signatureHeader()).toBe(digest('whsec_new'));
    });
  });

  describe('API surface', () => {
    it('passes the requested window to the service and never returns the old secret', async () => {
      const rotated = makeEndpoint({
        secret: 'whsec_new',
        previousSecret: 'whsec_old',
        previousSecretExpiresAt: new Date(NOW.getTime() + hours(2)),
      });
      const service = { rotateSecret: jest.fn().mockResolvedValue(rotated) };
      const controller = new WebhooksController(
        service as unknown as WebhooksService,
        {} as never,
        {} as never,
      );

      const response = await controller.rotateSecret(
        'e1',
        { gracePeriodHours: 2 },
        { id: 'm1' } as never,
      );

      expect(service.rotateSecret).toHaveBeenCalledWith('e1', 'm1', 2);
      expect(response.secret).toBe('whsec_new');
      expect(response.previousSecret).toBe('********');
      expect(response.previousSecretExpiresAt).toEqual(
        rotated.previousSecretExpiresAt,
      );
      expect(JSON.stringify(response)).not.toContain('whsec_old');
    });

    it('masks the previous secret in any endpoint response', () => {
      expect(maskEndpoint({ previousSecret: 'whsec_old' }).previousSecret).toBe(
        '********',
      );
      expect(maskEndpoint({ previousSecret: null }).previousSecret).toBeNull();
    });

    it('validates the grace period between 0 and 168 whole hours', async () => {
      const check = (value: unknown) =>
        validate(
          plainToInstance(RotateWebhookSecretDto, { gracePeriodHours: value }),
        );

      expect(await check(0)).toHaveLength(0);
      expect(await check(168)).toHaveLength(0);
      expect(
        await validate(plainToInstance(RotateWebhookSecretDto, {})),
      ).toHaveLength(0);
      expect(await check(-1)).not.toHaveLength(0);
      expect(await check(169)).not.toHaveLength(0);
      expect(await check(1.5)).not.toHaveLength(0);
    });
  });
});
