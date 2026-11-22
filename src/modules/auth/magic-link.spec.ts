jest.mock('otplib', () => ({ verifySync: jest.fn(() => ({ valid: true })) }));
import { AuthService } from './auth.service';
import { createHash } from 'crypto';

describe('Magic-link authentication', () => {
  let service: AuthService;
  let user: any;
  let users: any;
  let jwt: any;
  let repo: any;
  let query: any;
  let manager: any;
  let mail: any;
  let complete: jest.Mock;
  beforeEach(() => {
    user = { id: 'u1', email: 'user@example.com', isActive: true, isEmailVerified: true };
    users = { findByEmail: jest.fn().mockResolvedValue(user), findByIdWithSecrets: jest.fn().mockResolvedValue(user), isAccountLocked: jest.fn().mockReturnValue(false), incrementFailedLoginAttempts: jest.fn(), consumeBackupCode: jest.fn().mockResolvedValue(false) };
    jwt = { signAsync: jest.fn().mockResolvedValue('signed-token'), verifyAsync: jest.fn().mockResolvedValue({ sub: 'u1', purpose: 'magic-link' }) };
    query = {};
    for (const method of ['update', 'set', 'where', 'andWhere']) query[method] = jest.fn().mockReturnValue(query);
    query.execute = jest.fn().mockResolvedValue({ affected: 1 });
    repo = { findBy: jest.fn().mockResolvedValue([]), existsBy: jest.fn().mockResolvedValue(false), save: jest.fn(), createQueryBuilder: jest.fn().mockReturnValue(query) };
    manager = { query: jest.fn().mockResolvedValue([{ count: 1 }]) };
    mail = { sendMagicLinkEmail: jest.fn() };
    complete = jest.fn().mockResolvedValue({ access_token: 'access', refresh_token: 'refresh' });
    service = Object.assign(Object.create(AuthService.prototype), {
      usersService: users, jwtService: jwt, mailService: mail,
      dataSource: { transaction: jest.fn(callback => callback(manager)), getRepository: () => repo },
      webAuthnService: { hasCredentials: jest.fn().mockResolvedValue(false) },
      logger: { warn: jest.fn() }, completeLogin: complete,
      maxFailedAttempts: 5, lockDurationMinutes: 15,
      decryptTwoFactorSecret: jest.fn().mockReturnValue('secret'),
    });
  });
  it('returns the same response for existing and nonexistent emails', async () => {
    const existing = await service.requestMagicLink(' USER@example.com ', '127.0.0.1');
    expect(users.findByEmail).toHaveBeenCalledWith('user@example.com');
    users.findByEmail.mockResolvedValue(null);
    expect(await service.requestMagicLink('missing@example.com', '127.0.0.1')).toEqual(existing);
    expect(mail.sendMagicLinkEmail).toHaveBeenCalledTimes(1);
  });
  it('stores only a hash of a signed 15-minute token', async () => {
    await service.requestMagicLink(user.email, '127.0.0.1');
    expect(jwt.signAsync).toHaveBeenCalledWith(expect.objectContaining({ sub: user.id, purpose: 'magic-link', jti: expect.any(String) }), { expiresIn: '15m' });
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ tokenHash: createHash('sha256').update('signed-token').digest('hex'), used: false }));
    expect(mail.sendMagicLinkEmail).toHaveBeenCalledWith(user.email, 'signed-token');
  });
  it.each([0, 1])('limits each email and IP before looking up the account (%s)', async blocked => {
    manager.query.mockImplementation((_sql: string, params: string[]) => Promise.resolve([{ count: params[0] === createHash('sha256').update(blocked ? 'ip:127.0.0.1' : 'email:user@example.com').digest('hex') ? 6 : 1 }]));
    await expect(service.requestMagicLink(user.email, '127.0.0.1')).rejects.toMatchObject({ status: 429 });
    expect(users.findByEmail).not.toHaveBeenCalled();
  });
  it('keeps the generic response when email delivery fails', async () => {
    mail.sendMagicLinkEmail.mockRejectedValue(new Error('SMTP down'));
    await expect(service.requestMagicLink(user.email)).resolves.toHaveProperty('message');
  });
  it('does not bypass mandatory SAML SSO or consume the link', async () => {
    repo.existsBy.mockResolvedValue(true);
    await expect(service.verifyMagicLink('signed-token')).rejects.toThrow('requires SAML SSO');
    expect(query.execute).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });
  it('redeems once and rejects replay before issuing new tokens', async () => {
    query.execute.mockResolvedValueOnce({ affected: 1 }).mockResolvedValue({ affected: 0 });
    await expect(service.verifyMagicLink('signed-token')).resolves.toEqual({ access_token: 'access', refresh_token: 'refresh' });
    await expect(service.verifyMagicLink('signed-token')).rejects.toThrow('Invalid or expired');
    expect(complete).toHaveBeenCalledTimes(1);
    expect(query.andWhere).toHaveBeenCalledWith('used = false');
    expect(query.andWhere).toHaveBeenCalledWith('"expiresAt" > :now', expect.any(Object));
  });
  it.each(['email-verification', 'access'])('rejects wrong-purpose tokens (%s)', async purpose => {
    jwt.verifyAsync.mockResolvedValue({ sub: 'u1', purpose });
    await expect(service.verifyMagicLink('token')).rejects.toThrow();
    expect(query.execute).not.toHaveBeenCalled();
  });
  it('rejects expired signed tokens', async () => {
    jwt.verifyAsync.mockRejectedValue(new Error('expired'));
    await expect(service.verifyMagicLink('token')).rejects.toThrow();
    expect(complete).not.toHaveBeenCalled();
  });
  it.each(['deletedAt', 'passwordResetRequired'])('rejects an ineligible account (%s)', async field => {
    user[field] = true;
    await expect(service.verifyMagicLink('token')).rejects.toThrow();
  });
  it('returns a persisted second-factor challenge without issuing access tokens', async () => {
    user.twoFactorEnabled = true;
    user.twoFactorSecret = 'encrypted';
    expect(await service.verifyMagicLink('token')).toMatchObject({ '2fa_required': true, twoFactorToken: 'signed-token', availableMethods: ['totp'] });
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ tokenHash: createHash('sha256').update('signed-token').digest('hex') }));
    expect(complete).not.toHaveBeenCalled();
  });
  it('completes TOTP authentication only once for a persisted challenge', async () => {
    user.twoFactorEnabled = true;
    user.twoFactorSecret = 'encrypted';
    jwt.verifyAsync.mockResolvedValue({ sub: 'u1', purpose: 'two-factor-login' });
    await expect(service.verifyMagicLink('challenge')).rejects.toThrow('Invalid two-factor code');
    expect(query.execute).not.toHaveBeenCalled();
    await expect(service.verifyMagicLink('challenge', undefined, undefined, undefined, '123456')).resolves.toHaveProperty('access_token');
    query.execute.mockResolvedValue({ affected: 0 });
    await expect(service.verifyMagicLink('challenge', undefined, undefined, undefined, '123456')).rejects.toThrow();
    expect(complete).toHaveBeenCalledTimes(1);
  });
});
