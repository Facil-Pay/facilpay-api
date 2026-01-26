import { sanitizeBody, sanitizeHeaders } from './logging.utils';

describe('logging utils', () => {
  it('redacts sensitive headers', () => {
    const headers = {
      authorization: 'Bearer token',
      cookie: 'session=secret',
      'set-cookie': 'session=secret',
      'x-request-id': 'abc',
    };

    const sanitized = sanitizeHeaders(headers);

    expect(sanitized).toEqual({
      authorization: '[REDACTED]',
      cookie: '[REDACTED]',
      'set-cookie': '[REDACTED]',
      'x-request-id': 'abc',
    });
  });

  it('redacts sensitive body fields', () => {
    const payload = {
      email: 'user@example.com',
      password: 'secret',
      token: 'abc',
      profile: {
        pin: '1234',
        cardNumber: '4111111111111111',
      },
    };

    const sanitized = sanitizeBody(payload, 2048) as Record<string, unknown>;

    expect(sanitized).toEqual({
      email: 'user@example.com',
      password: '[REDACTED]',
      token: '[REDACTED]',
      profile: {
        pin: '[REDACTED]',
        cardNumber: '[REDACTED]',
      },
    });
  });
});
