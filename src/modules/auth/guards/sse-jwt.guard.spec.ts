import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SseJwtGuard } from './sse-jwt.guard';

describe('SseJwtGuard', () => {
  let guard: SseJwtGuard;

  const createContext = (
    headers: Record<string, string | undefined> = {},
    query: Record<string, string | undefined> = {},
  ): { context: ExecutionContext; req: { headers: Record<string, string | undefined>; query: Record<string, string | undefined> } } => {
    const req = { headers, query };
    const context = {
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => ({}),
      }),
    } as unknown as ExecutionContext;
    return { context, req };
  };

  beforeEach(() => {
    guard = new SseJwtGuard();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('copies ?token= query parameter into Authorization Bearer header when header is absent', async () => {
    const superSpy = jest
      .spyOn(AuthGuard('jwt').prototype, 'canActivate')
      .mockResolvedValue(true as never);
    const { context, req } = createContext({}, { token: 'sse-query-jwt' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.headers.authorization).toBe('Bearer sse-query-jwt');
    expect(superSpy).toHaveBeenCalledWith(context);
  });

  it('preserves existing Authorization header even when ?token= query parameter is present', async () => {
    const superSpy = jest
      .spyOn(AuthGuard('jwt').prototype, 'canActivate')
      .mockResolvedValue(true as never);
    const { context, req } = createContext(
      { authorization: 'Bearer header-jwt' },
      { token: 'sse-query-jwt' },
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.headers.authorization).toBe('Bearer header-jwt');
    expect(superSpy).toHaveBeenCalledWith(context);
  });

  it('leaves Authorization header unset when neither header nor ?token= is provided and rejects with UnauthorizedException', async () => {
    jest
      .spyOn(AuthGuard('jwt').prototype, 'canActivate')
      .mockRejectedValue(new UnauthorizedException('Missing token') as never);
    const { context, req } = createContext({}, {});

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(req.headers.authorization).toBeUndefined();
  });

  it('throws UnauthorizedException for expired SSE token in handleRequest', () => {
    const expiredInfo = Object.assign(new Error('jwt expired'), {
      name: 'TokenExpiredError',
    });
    expect(() => guard.handleRequest(null, false, expiredInfo)).toThrow(
      UnauthorizedException,
    );
  });
});
