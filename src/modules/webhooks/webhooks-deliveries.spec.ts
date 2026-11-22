// The real logger pulls in src/tracing.ts, which needs OpenTelemetry packages
// that are not installed everywhere; none of these tests need it.
jest.mock('../logger/logger.service', () => ({
  AppLogger: class AppLogger {},
}));

import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { of, throwError } from 'rxjs';
import { WebhooksController } from './webhooks.controller';
import { WebhooksProcessor } from './webhooks.processor';
import { WebhooksService } from './webhooks.service';
import { RESPONSE_BODY_MAX_LENGTH } from './delivery-response';
import { ListWebhookDeliveriesDto } from './dto/list-webhook-deliveries.dto';
import {
  WebhookDelivery,
  WebhookDeliveryStatus,
} from './entities/webhook-delivery.entity';
import { WebhookEndpoint } from './entities/webhook-endpoint.entity';

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

describe('GET /v1/webhooks/:id/deliveries', () => {
  let endpointRepo: { findOneBy: jest.Mock };
  let query: Record<string, jest.Mock>;
  let service: WebhooksService;

  const listDto = (overrides: Partial<ListWebhookDeliveriesDto> = {}) =>
    Object.assign(new ListWebhookDeliveriesDto(), overrides);

  beforeEach(() => {
    endpointRepo = {
      findOneBy: jest
        .fn()
        .mockResolvedValue(
          Object.assign(new WebhookEndpoint(), { id: 'e1', merchantId: 'm1' }),
        ),
    };
    query = {};
    for (const name of [
      'where',
      'andWhere',
      'orderBy',
      'addOrderBy',
      'skip',
      'take',
    ]) {
      query[name] = jest.fn().mockReturnValue(query);
    }
    query.getManyAndCount = jest.fn().mockResolvedValue([[], 0]);
    service = new WebhooksService(
      endpointRepo as never,
      { createQueryBuilder: jest.fn().mockReturnValue(query) } as never,
      {} as never,
      {} as never,
      {} as never,
      { get: (_key: string, fallback: unknown) => fallback } as never,
      {} as never,
      { child: () => logger } as never,
    );
  });

  it('scopes the query to the endpoint and paginates newest first', async () => {
    const result = await service.listDeliveries(
      'e1',
      'm1',
      listDto({ page: 3, limit: 10 }),
    );

    expect(query.where).toHaveBeenCalledWith('delivery.endpointId = :id', {
      id: 'e1',
    });
    expect(query.orderBy).toHaveBeenCalledWith('delivery.createdAt', 'DESC');
    expect(query.skip).toHaveBeenCalledWith(20);
    expect(query.take).toHaveBeenCalledWith(10);
    expect(result).toEqual({ data: [], total: 0, page: 3, limit: 10 });
  });

  it('applies the status, event type and date range filters', async () => {
    await service.listDeliveries(
      'e1',
      'm1',
      listDto({
        status: WebhookDeliveryStatus.FAILED,
        eventType: 'payment.completed',
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-01-31T23:59:59.999Z',
      }),
    );

    expect(query.andWhere).toHaveBeenCalledWith('delivery.status = :status', {
      status: 'failed',
    });
    expect(query.andWhere).toHaveBeenCalledWith(
      "delivery.payload->>'event' = :eventType",
      {
        eventType: 'payment.completed',
      },
    );
    expect(query.andWhere).toHaveBeenCalledWith('delivery.createdAt >= :from', {
      from: new Date('2026-01-01T00:00:00.000Z'),
    });
    expect(query.andWhere).toHaveBeenCalledWith('delivery.createdAt <= :to', {
      to: new Date('2026-01-31T23:59:59.999Z'),
    });
  });

  it('adds no filter predicates when none are requested', async () => {
    await service.listDeliveries('e1', 'm1', listDto());

    expect(query.andWhere).not.toHaveBeenCalled();
  });

  it('returns status, response code, latency, event type and the truncated body', async () => {
    const createdAt = new Date('2026-01-26T10:00:00.000Z');
    query.getManyAndCount.mockResolvedValue([
      [
        Object.assign(new WebhookDelivery(), {
          id: 'd1',
          payload: {
            event: 'payment.completed',
            data: { secret: 'not echoed' },
          },
          status: WebhookDeliveryStatus.FAILED,
          attempts: 2,
          lastResponseCode: 500,
          latencyMs: 182,
          lastResponseBody: '{"error":"upstream timeout"}',
          lastError: 'Request failed with status code 500',
          lastAttemptAt: createdAt,
          createdAt,
        }),
        Object.assign(new WebhookDelivery(), {
          id: 'd2',
          payload: {},
          status: WebhookDeliveryStatus.PENDING,
          attempts: 0,
          lastResponseCode: null,
          latencyMs: null,
          lastResponseBody: null,
          lastError: null,
          lastAttemptAt: null,
          createdAt,
        }),
      ],
      2,
    ]);

    const result = await service.listDeliveries('e1', 'm1', listDto());

    expect(result.total).toBe(2);
    expect(result.data[0]).toEqual({
      id: 'd1',
      eventType: 'payment.completed',
      status: 'failed',
      attempts: 2,
      responseCode: 500,
      latencyMs: 182,
      responseBody: '{"error":"upstream timeout"}',
      error: 'Request failed with status code 500',
      lastAttemptAt: createdAt,
      createdAt,
    });
    expect(result.data[1].eventType).toBeNull();
    expect(JSON.stringify(result)).not.toContain('not echoed');
  });

  it('is merchant-scoped: another merchant or an unknown endpoint never reaches the deliveries', async () => {
    await expect(
      service.listDeliveries('e1', 'other', listDto()),
    ).rejects.toThrow(ForbiddenException);

    endpointRepo.findOneBy.mockResolvedValue(null);
    await expect(
      service.listDeliveries('missing', 'm1', listDto()),
    ).rejects.toThrow(NotFoundException);
    expect(query.getManyAndCount).not.toHaveBeenCalled();
  });

  it('rejects a date range that ends before it starts', async () => {
    await expect(
      service.listDeliveries(
        'e1',
        'm1',
        listDto({
          from: '2026-02-01T00:00:00.000Z',
          to: '2026-01-01T00:00:00.000Z',
        }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('forwards the authenticated merchant from the controller', async () => {
    const serviceMock = {
      listDeliveries: jest.fn().mockResolvedValue({ data: [] }),
    };
    const controller = new WebhooksController(
      serviceMock as unknown as WebhooksService,
      {} as never,
      {} as never,
    );
    const dto = listDto({ limit: 5 });

    await controller.listDeliveries('e1', dto, { id: 'm1' } as never);

    expect(serviceMock.listDeliveries).toHaveBeenCalledWith('e1', 'm1', dto);
  });

  it('validates the filters', async () => {
    const check = (input: object) =>
      validate(plainToInstance(ListWebhookDeliveriesDto, input));

    expect(await check({})).toHaveLength(0);
    expect(
      await check({
        status: 'dead-letter',
        limit: '100',
        from: '2026-01-01T00:00:00Z',
      }),
    ).toHaveLength(0);
    expect(await check({ status: 'bogus' })).not.toHaveLength(0);
    expect(await check({ limit: '101' })).not.toHaveLength(0);
    expect(await check({ page: '0' })).not.toHaveLength(0);
    expect(await check({ from: 'yesterday' })).not.toHaveLength(0);
  });
});

describe('WebhooksProcessor response capture', () => {
  const setup = (post: jest.Mock) => {
    const delivery = new WebhookDelivery();
    delivery.lastResponseBody = 'left over from an earlier attempt';
    const endpoint = Object.assign(new WebhookEndpoint(), {
      id: 'e1',
      secret: 'whsec_x',
    });
    const processor = new WebhooksProcessor(
      {
        findOne: jest.fn().mockResolvedValue(delivery),
        save: jest.fn(),
      } as never,
      { findOne: jest.fn().mockResolvedValue(endpoint) } as never,
      { post } as never,
      {
        recordDeliverySuccess: jest.fn(),
        recordDeliveryFailure: jest.fn(),
      } as never,
      { child: () => logger } as never,
    );
    const job = {
      data: { deliveryId: 'd1', endpointId: 'e1', payload: { event: 'test' } },
      attemptsMade: 0,
      opts: { attempts: 6 },
    } as never;
    return { delivery, run: () => processor.process(job) };
  };

  it('stores the response body of a successful delivery', async () => {
    const { delivery, run } = setup(
      jest.fn().mockReturnValue(of({ status: 200, data: { received: true } })),
    );

    await run();

    expect(delivery.lastResponseBody).toBe('{"received":true}');
    expect(delivery.lastResponseCode).toBe(200);
    expect(delivery.latencyMs).not.toBeNull();
  });

  it('stores a truncated body when the endpoint answers with an error', async () => {
    const error = Object.assign(
      new Error('Request failed with status code 502'),
      {
        response: {
          status: 502,
          data: 'x'.repeat(RESPONSE_BODY_MAX_LENGTH * 4),
        },
      },
    );
    const { delivery, run } = setup(
      jest.fn().mockReturnValue(throwError(() => error)),
    );

    await expect(run()).rejects.toThrow('502');

    expect(delivery.lastResponseCode).toBe(502);
    expect(delivery.lastResponseBody).toBe(
      `${'x'.repeat(RESPONSE_BODY_MAX_LENGTH)}…`,
    );
  });

  it('clears the body when the endpoint could not be reached at all', async () => {
    const { delivery, run } = setup(
      jest
        .fn()
        .mockReturnValue(throwError(() => new Error('connect ECONNREFUSED'))),
    );

    await expect(run()).rejects.toThrow('ECONNREFUSED');

    expect(delivery.lastResponseCode).toBeNull();
    expect(delivery.lastResponseBody).toBeNull();
  });
});
