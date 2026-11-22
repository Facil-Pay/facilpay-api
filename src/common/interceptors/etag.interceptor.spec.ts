import { ExecutionContext, CallHandler } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of, lastValueFrom } from 'rxjs';
import { ETagInterceptor } from './etag.interceptor';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext({
  method = 'GET',
  ifNoneMatch = '',
  handlerHasDecorator = true,
}: {
  method?: string;
  ifNoneMatch?: string;
  handlerHasDecorator?: boolean;
}): { ctx: ExecutionContext; res: Record<string, any> } {
  const res: Record<string, any> = {
    _headers: {} as Record<string, string>,
    _status: 200,
    setHeader(key: string, value: string) {
      this._headers[key] = value;
    },
    status(code: number) {
      this._status = code;
      return this;
    },
    end() {
      this._ended = true;
    },
    _ended: false,
  };

  const req = {
    method,
    headers: { 'if-none-match': ifNoneMatch },
  };

  const ctx = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
  } as unknown as ExecutionContext;

  const reflector = new Reflector();
  // Spy: getAllAndOverride returns whether the handler has the decorator
  jest
    .spyOn(reflector, 'getAllAndOverride')
    .mockReturnValue(handlerHasDecorator);

  return { ctx, res };
}

function makeNext(body: unknown): CallHandler {
  return { handle: () => of(body) };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ETagInterceptor', () => {
  let reflector: Reflector;
  let interceptor: ETagInterceptor;

  beforeEach(() => {
    reflector = new Reflector();
    interceptor = new ETagInterceptor(reflector);
  });

  afterEach(() => jest.restoreAllMocks());

  // -------------------------------------------------------------------------
  // computeETag
  // -------------------------------------------------------------------------
  describe('computeETag()', () => {
    it('returns a weak ETag string starting with W/"', () => {
      const etag = ETagInterceptor.computeETag({ id: '1' });
      expect(etag).toMatch(/^W\/"[0-9a-f]{16}"$/);
    });

    it('returns the same ETag for identical bodies', () => {
      const body = { id: 'abc', updatedAt: '2026-01-01T00:00:00Z' };
      expect(ETagInterceptor.computeETag(body)).toBe(
        ETagInterceptor.computeETag(body),
      );
    });

    it('returns different ETags for different bodies', () => {
      const a = ETagInterceptor.computeETag({ id: '1' });
      const b = ETagInterceptor.computeETag({ id: '2' });
      expect(a).not.toBe(b);
    });

    it('handles null / undefined body gracefully', () => {
      expect(() => ETagInterceptor.computeETag(null)).not.toThrow();
      expect(() => ETagInterceptor.computeETag(undefined)).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // matches()
  // -------------------------------------------------------------------------
  describe('matches()', () => {
    it('matches when etag equals the If-None-Match value exactly', () => {
      expect(ETagInterceptor.matches('W/"abc123"', 'W/"abc123"')).toBe(true);
    });

    it('matches using weak comparison (ignores W/ prefix)', () => {
      expect(ETagInterceptor.matches('"abc123"', 'W/"abc123"')).toBe(true);
    });

    it('matches when the etag is one of a comma-separated list', () => {
      expect(
        ETagInterceptor.matches('"aaa", W/"abc123", "bbb"', 'W/"abc123"'),
      ).toBe(true);
    });

    it('matches on wildcard *', () => {
      expect(ETagInterceptor.matches('*', 'W/"anything"')).toBe(true);
    });

    it('does not match when values differ', () => {
      expect(ETagInterceptor.matches('W/"different"', 'W/"abc123"')).toBe(
        false,
      );
    });
  });

  // -------------------------------------------------------------------------
  // intercept() — no decorator
  // -------------------------------------------------------------------------
  describe('intercept() — handler without @UseETag()', () => {
    it('passes through without setting ETag header', async () => {
      const { ctx, res } = makeContext({ handlerHasDecorator: false });
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
      interceptor = new ETagInterceptor(reflector);

      const body = { id: '1' };
      const result$ = await interceptor.intercept(ctx, makeNext(body));
      const result = await lastValueFrom(result$);

      expect(result).toEqual(body);
      expect(res._headers['ETag']).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // intercept() — non-GET method
  // -------------------------------------------------------------------------
  describe('intercept() — non-GET method', () => {
    it('passes through for POST even when decorator is present', async () => {
      const { ctx, res } = makeContext({ method: 'POST' });
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
      interceptor = new ETagInterceptor(reflector);

      const body = { id: '1' };
      const result$ = await interceptor.intercept(ctx, makeNext(body));
      const result = await lastValueFrom(result$);

      expect(result).toEqual(body);
      expect(res._headers['ETag']).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // intercept() — fresh GET (no If-None-Match)
  // -------------------------------------------------------------------------
  describe('intercept() — fresh GET request', () => {
    it('sets ETag header and returns body unchanged', async () => {
      const { ctx, res } = makeContext({});
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
      interceptor = new ETagInterceptor(reflector);

      const body = { id: '42', name: 'Test' };
      const result$ = await interceptor.intercept(ctx, makeNext(body));
      const result = await lastValueFrom(result$);

      expect(result).toEqual(body);
      expect(res._headers['ETag']).toMatch(/^W\/"[0-9a-f]{16}"$/);
      expect(res._ended).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // intercept() — conditional GET (matching ETag → 304)
  // -------------------------------------------------------------------------
  describe('intercept() — conditional GET with matching If-None-Match', () => {
    it('returns 304 and ends the response without a body', async () => {
      const body = { id: '42', name: 'Test' };
      const matchingETag = ETagInterceptor.computeETag(body);

      const { ctx, res } = makeContext({ ifNoneMatch: matchingETag });
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
      interceptor = new ETagInterceptor(reflector);

      const result$ = await interceptor.intercept(ctx, makeNext(body));
      const result = await lastValueFrom(result$);

      expect(res._status).toBe(304);
      expect(res._ended).toBe(true);
      expect(result).toBeUndefined();
    });

    it('still sets ETag header before sending 304', async () => {
      const body = { id: '99' };
      const matchingETag = ETagInterceptor.computeETag(body);

      const { ctx, res } = makeContext({ ifNoneMatch: matchingETag });
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
      interceptor = new ETagInterceptor(reflector);

      await lastValueFrom(await interceptor.intercept(ctx, makeNext(body)));

      expect(res._headers['ETag']).toBe(matchingETag);
    });
  });

  // -------------------------------------------------------------------------
  // intercept() — conditional GET (stale ETag → 200)
  // -------------------------------------------------------------------------
  describe('intercept() — conditional GET with stale If-None-Match', () => {
    it('returns 200 with full body when ETag does not match', async () => {
      const body = { id: '42', name: 'Updated' };
      const staleETag = 'W/"stalevalue000"';

      const { ctx, res } = makeContext({ ifNoneMatch: staleETag });
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
      interceptor = new ETagInterceptor(reflector);

      const result$ = await interceptor.intercept(ctx, makeNext(body));
      const result = await lastValueFrom(result$);

      expect(result).toEqual(body);
      expect(res._status).toBe(200);
      expect(res._ended).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // intercept() — wildcard If-None-Match: *
  // -------------------------------------------------------------------------
  describe('intercept() — wildcard If-None-Match', () => {
    it('returns 304 for If-None-Match: *', async () => {
      const body = { id: '1' };
      const { ctx, res } = makeContext({ ifNoneMatch: '*' });
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
      interceptor = new ETagInterceptor(reflector);

      const result$ = await interceptor.intercept(ctx, makeNext(body));
      await lastValueFrom(result$);

      expect(res._status).toBe(304);
      expect(res._ended).toBe(true);
    });
  });
});
