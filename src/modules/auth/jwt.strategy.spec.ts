jest.mock('otplib', () => ({ verifySync: jest.fn() }));
import type { Request } from 'express';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';

// Keep both session-bound JWT coverage from main and team policy coverage.
describe('Session-bound JWTs and merchant security policies', () => {
  const request = { method: 'GET', path: '/v1/payments' } as Request;
  let strategy: JwtStrategy;
  let sessions: any;
  let auth: any;
  let security: any;
  beforeEach(() => {
    sessions = { touchSession: jest.fn().mockResolvedValue({ id: 's1' }) };
    auth = { validateUser: jest.fn().mockResolvedValue({ id: 'u1', roles: [] }) };
    security = { enforce: jest.fn().mockResolvedValue(undefined) };
    strategy = new JwtStrategy(new ConfigService({ JWT_SECRET: 'test' }), auth, security, sessions);
  });
  it.each(['magic-link', 'two-factor-login', 'email-verification', 'step-up'])('rejects purpose-scoped %s tokens as access tokens', async purpose => {
    await expect(strategy.validate(request, { sub: 'u1', purpose })).rejects.toThrow('access token');
    expect(auth.validateUser).not.toHaveBeenCalled();
    expect(sessions.touchSession).not.toHaveBeenCalled();
  });
  it('updates activity for the verified user and session and enforces team policy', async () => {
    await strategy.validate(request, { sub: 'u1', sid: 's1' });
    expect(sessions.touchSession).toHaveBeenCalledWith('s1', undefined, undefined, 'u1');
    expect(security.enforce).toHaveBeenCalledWith('u1', 'GET', '/v1/payments');
  });
  it('rejects expired or revoked sessions', async () => {
    sessions.touchSession.mockResolvedValue(null);
    await expect(strategy.validate(request, { sub: 'u1', sid: 's1' })).rejects.toThrow('Session expired or revoked');
    expect(security.enforce).not.toHaveBeenCalled();
  });
  it('preserves existing access tokens until refresh supplies a session ID', async () => {
    await expect(strategy.validate(request, { sub: 'u1' })).resolves.toMatchObject({ id: 'u1' });
    expect(sessions.touchSession).not.toHaveBeenCalled();
    expect(security.enforce).toHaveBeenCalledWith('u1', 'GET', '/v1/payments');
  });
  it('restricts unenrolled team members even with an active session', async () => {
    security.enforce.mockRejectedValue(new Error('setup required'));
    await expect(strategy.validate(request, { sub: 'u1', sid: 's1' })).rejects.toThrow('setup required');
    expect(security.enforce).toHaveBeenCalledWith('u1', 'GET', '/v1/payments');
  });
});
