import { SessionsService } from './sessions.service';

describe('Idle session timeout', () => {
  let session: any;
  let sessions: any;
  let tokens: any;
  let settings: any;
  let members: any;
  let service: SessionsService;
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-19T12:00:00Z'));
    session = { id: 's1', userId: 'u1', revoked: false, lastSeenAt: new Date('2026-10-19T11:30:00Z'), expiresAt: new Date('2026-11-01') };
    sessions = { findOneBy: jest.fn().mockResolvedValue(session), save: jest.fn(value => Promise.resolve(value)) };
    tokens = { update: jest.fn() };
    settings = { find: jest.fn().mockResolvedValue([]) };
    members = { find: jest.fn().mockResolvedValue([]) };
    service = new SessionsService(sessions, tokens, settings, members);
  });
  afterEach(() => jest.useRealTimers());
  it('preserves default behavior and updates activity', async () => {
    expect(await service.touchSession('s1')).toMatchObject({ lastSeenAt: new Date(), lastActiveAt: new Date() });
    expect(tokens.update).not.toHaveBeenCalled();
  });
  it('rejects idle sessions at the limit and revokes the session', async () => {
    settings.find.mockResolvedValue([{ idleSessionTimeoutMinutes: 30 }]);
    expect(await service.touchSession('s1')).toBeNull();
    expect(session.revoked).toBe(true);
    expect(session.lastSeenAt).toEqual(new Date('2026-10-19T11:30:00Z'));
  });
  it('uses the strictest merchant policy for team members', async () => {
    members.find.mockResolvedValue([{ merchantId: 'merchant' }]);
    settings.find.mockResolvedValue([{ idleSessionTimeoutMinutes: null }, { idleSessionTimeoutMinutes: 15 }]);
    expect(await service.touchSession('s1')).toBeNull();
  });
  it('allows sessions just inside the idle limit', async () => {
    settings.find.mockResolvedValue([{ idleSessionTimeoutMinutes: 31 }]);
    expect(await service.touchSession('s1')).not.toBeNull();
  });
  it('rejects revoked, missing, expired and wrong-owner sessions', async () => {
    session.revoked = true;
    expect(await service.touchSession('s1')).toBeNull();
    session.revoked = false;
    expect(await service.touchSession('s1', undefined, undefined, 'other')).toBeNull();
    session.expiresAt = new Date('2026-10-18');
    expect(await service.touchSession('s1')).toBeNull();
    sessions.findOneBy.mockResolvedValue(null);
    expect(await service.touchSession('s1')).toBeNull();
  });
});
