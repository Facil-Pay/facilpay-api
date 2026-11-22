import {
  RESPONSE_BODY_MAX_LENGTH,
  truncateResponseBody,
} from './delivery-response';

describe('truncateResponseBody', () => {
  it('returns null when there is nothing to store', () => {
    expect(truncateResponseBody(undefined)).toBeNull();
    expect(truncateResponseBody(null)).toBeNull();
    expect(truncateResponseBody('')).toBeNull();
  });

  it('keeps short bodies and serialises parsed JSON', () => {
    expect(truncateResponseBody('ok')).toBe('ok');
    expect(truncateResponseBody({ error: 'upstream timeout' })).toBe(
      '{"error":"upstream timeout"}',
    );
  });

  it('cuts long bodies to the maximum length and marks the cut', () => {
    const result = truncateResponseBody('x'.repeat(5000));

    expect(result).toBe(`${'x'.repeat(RESPONSE_BODY_MAX_LENGTH)}…`);
  });

  it('removes NUL characters that Postgres text columns reject', () => {
    expect(truncateResponseBody('a\u0000b')).toBe('ab');
  });

  it('gives up quietly on values that cannot be serialised', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(truncateResponseBody(circular)).toBeNull();
    expect(truncateResponseBody(10n)).toBeNull();
  });
});
