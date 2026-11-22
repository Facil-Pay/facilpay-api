import { createHmac } from 'crypto';
import { isPreviousSecretActive, signBody } from './webhook-signing';

const body = JSON.stringify({ event: 'payment.completed', data: { id: 'p1' } });
const digest = (secret: string) =>
  createHmac('sha256', secret).update(body).digest('hex');

describe('webhook signing', () => {
  const now = new Date('2026-10-21T12:00:00.000Z');
  const hoursFromNow = (hours: number) =>
    new Date(now.getTime() + hours * 3600_000);

  it('signs with the current secret only when nothing was rotated', () => {
    expect(signBody(body, { secret: 'new' }, now)).toBe(digest('new'));
  });

  it('signs with both secrets, current first, while the grace period is open', () => {
    const header = signBody(
      body,
      {
        secret: 'new',
        previousSecret: 'old',
        previousSecretExpiresAt: hoursFromNow(24),
      },
      now,
    );

    expect(header.split(',')).toEqual([digest('new'), digest('old')]);
  });

  it('drops the previous secret once the grace period has ended', () => {
    const endpoint = {
      secret: 'new',
      previousSecret: 'old',
      previousSecretExpiresAt: hoursFromNow(-1),
    };

    expect(signBody(body, endpoint, now)).toBe(digest('new'));
    expect(isPreviousSecretActive(endpoint, now)).toBe(false);
  });

  it('treats the exact expiry instant as expired and ignores a previous secret without an expiry', () => {
    expect(
      isPreviousSecretActive(
        { secret: 'new', previousSecret: 'old', previousSecretExpiresAt: now },
        now,
      ),
    ).toBe(false);
    expect(
      isPreviousSecretActive({ secret: 'new', previousSecret: 'old' }, now),
    ).toBe(false);
  });

  it('accepts an expiry stored as an ISO string', () => {
    expect(
      isPreviousSecretActive(
        {
          secret: 'new',
          previousSecret: 'old',
          previousSecretExpiresAt: hoursFromNow(1).toISOString(),
        },
        now,
      ),
    ).toBe(true);
  });
});
