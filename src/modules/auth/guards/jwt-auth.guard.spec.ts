import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let reflector: jest.Mocked<Pick<Reflector, 'getAllAndOverride'>>;

  const createContext = (headers: Record<string, string> = {}): ExecutionContext => {
    const handler = jest.fn();
    const cls = class TestController {};
    return {
      getHandler: () => handler,
      getClass: () => cls,
      switchToHttp: () => ({
        getRequest: () => ({ headers }),
        getResponse: () => ({}),
      }),
    } as unknown as ExecutionContext;
  };

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn(),
    };
    guard = new JwtAuthGuard(reflector as unknown as Reflector);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('bypasses JWT authentication when @Public() metadata is true', () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const superSpy = jest.spyOn(AuthGuard('jwt').prototype, 'canActivate');
    const context = createContext();

    expect(guard.canActivate(context)).toBe(true);
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(
      IS_PUBLIC_KEY,
      expect.any(Array),
    );
    expect(superSpy).not.toHaveBeenCalled();
  });

  it('delegates to Passport AuthGuard("jwt") and allows valid token', async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    const superSpy = jest
      .spyOn(AuthGuard('jwt').prototype, 'canActivate')
      .mockResolvedValue(true as never);
    const context = createContext({ authorization: 'Bearer valid.jwt.token' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(superSpy).toHaveBeenCalledWith(context);
  });

  it('throws UnauthorizedException when token is missing', () => {
    expect(() => guard.handleRequest(null, false, new Error('No auth token'))).toThrow(
      UnauthorizedException,
    );
  });

  it('throws UnauthorizedException when token is expired', () => {
    const expiredError = Object.assign(new Error('jwt expired'), {
      name: 'TokenExpiredError',
    });
    expect(() => guard.handleRequest(null, false, expiredError)).toThrow(
      UnauthorizedException,
    );
  });

  it('rethrows explicit authentication error when provided to handleRequest', () => {
    const unauthorized = new UnauthorizedException('Session expired or revoked');
    expect(() => guard.handleRequest(unauthorized, false, null)).toThrow(
      UnauthorizedException,
    );
    expect(() => guard.handleRequest(unauthorized, false, null)).toThrow(
      'Session expired or revoked',
    );
  });

  it('returns the authenticated user from handleRequest when valid', () => {
    const user = { id: 'user-1', email: 'merchant@example.com' };
    expect(guard.handleRequest(null, user, null)).toBe(user);
  });
});
