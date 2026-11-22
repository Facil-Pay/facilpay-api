import { EventsService } from './events.service';
import { Event } from './entities/event.entity';

describe('EventsService', () => {
  const createHarness = () => {
    const query = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn(),
    };
    const eventRepo = {
      create: jest.fn((data) => data),
      save: jest.fn((event) => Promise.resolve(event)),
      createQueryBuilder: jest.fn(() => query),
      findOneBy: jest.fn(),
      delete: jest.fn(),
    };
    const configService = { get: jest.fn((_key, defaultValue) => defaultValue) };
    const logger = { child: jest.fn(() => ({ info: jest.fn(), error: jest.fn() })) };
    const service = new EventsService(
      eventRepo as any,
      configService as any,
      logger as any,
    );
    return { service, eventRepo, query };
  };

  it('creates an event for its merchant and redacts sensitive payload fields', async () => {
    const harness = createHarness();
    const payload = {
      paymentId: 'payment-1',
      credentials: { apiKey: 'secret-key', password: 'secret-password' },
    };
    const expectedEvent = {
      merchantId: 'merchant-1',
      type: 'payment.updated',
      payload: {
        paymentId: 'payment-1',
        credentials: { apiKey: '[REDACTED]', password: '[REDACTED]' },
      },
    };

    await expect(
      harness.service.emit('merchant-1', 'payment.updated', payload),
    ).resolves.toEqual(expectedEvent);
    expect(harness.eventRepo.create).toHaveBeenCalledWith(expectedEvent);
    expect(harness.eventRepo.save).toHaveBeenCalledWith(expectedEvent);
  });

  it('filters by merchant, type, date range, and applies cursor pagination', async () => {
    const harness = createHarness();
    const createdAt = new Date('2026-10-01T12:00:00.000Z');
    const event = {
      id: 'event-1',
      merchantId: 'merchant-1',
      type: 'payment.updated',
      createdAt,
    } as Event;
    harness.query.getMany.mockResolvedValue([event]);
    const from = new Date('2026-10-01T00:00:00.000Z');
    const to = new Date('2026-10-02T00:00:00.000Z');
    const cursor = Buffer.from(`${createdAt.toISOString()}:event-1`).toString(
      'base64',
    );

    await expect(
      harness.service.findAll('merchant-1', {
        type: 'payment.updated',
        from,
        to,
        cursor,
        limit: 1,
      }),
    ).resolves.toEqual({
      data: [event],
      nextCursor: cursor,
      hasMore: false,
    });
    expect(harness.query.where).toHaveBeenCalledWith(
      'event.merchantId = :merchantId',
      { merchantId: 'merchant-1' },
    );
    expect(harness.query.andWhere).toHaveBeenCalledWith(
      'event.type = :type',
      { type: 'payment.updated' },
    );
    expect(harness.query.andWhere).toHaveBeenCalledWith(
      'event.createdAt >= :from',
      { from },
    );
    expect(harness.query.andWhere).toHaveBeenCalledWith(
      'event.createdAt <= :to',
      { to },
    );
    expect(harness.query.andWhere).toHaveBeenCalledWith(
      '(event.createdAt < :cursorDate OR (event.createdAt = :cursorDate AND event.id < :cursorId))',
      { cursorDate: createdAt, cursorId: 'event-1' },
    );
    expect(harness.query.take).toHaveBeenCalledWith(2);
  });

  it('returns a next cursor and hasMore when an extra event is fetched', async () => {
    const harness = createHarness();
    const first = {
      id: 'event-1',
      createdAt: new Date('2026-10-01T12:00:00.000Z'),
    } as Event;
    const second = {
      id: 'event-2',
      createdAt: new Date('2026-10-01T11:00:00.000Z'),
    } as Event;
    harness.query.getMany.mockResolvedValue([first, second]);

    await expect(
      harness.service.findAll('merchant-1', { limit: 1 }),
    ).resolves.toEqual({
      data: [first],
      nextCursor: Buffer.from(`${first.createdAt.toISOString()}:${first.id}`).toString('base64'),
      hasMore: true,
    });
  });
});