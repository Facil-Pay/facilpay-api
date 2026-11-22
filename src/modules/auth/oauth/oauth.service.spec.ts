import { createHash, randomUUID } from 'crypto';
import { oauthTestStore } from '../../../../test/support/oauth-test-store';
import { OAuthClient, OAuthCredential, OAuthGrant } from './oauth.entity';
import { ApproveOAuthDto } from './oauth.dto';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { REQUIRE_SCOPE_KEY } from '../../api-keys/decorators/require-scope.decorator';

describe('OAuth authorization service', () => {
  let store: ReturnType<typeof oauthTestStore>;
  let app: any;
  let authorization: ApproveOAuthDto;
  const merchant = randomUUID();
  const verifier = 'a'.repeat(43);
  beforeEach(async () => {
    store = oauthTestStore();
    app = await store.service.register(randomUUID(), { name: 'Accounting', redirectUris: ['https://app.example/callback'], scopes: ['customers:read'] });
    authorization = { response_type: 'code', client_id: app.client_id, redirect_uri: 'https://app.example/callback', scope: 'customers:read',
      code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url'), state: 'opaque-state', approved: true };
  });
  async function authorize() {
    const result = await store.service.authorize(merchant, authorization);
    return new URL(result.redirectUrl).searchParams.get('code')!;
  }
  async function exchange(code: string, codeVerifier = verifier) {
    return store.service.exchange({ grant_type: 'authorization_code', client_id: app.client_id, client_secret: app.client_secret,
      code, code_verifier: codeVerifier, redirect_uri: authorization.redirect_uri });
  }
  it('returns consent data without exposing the client secret hash', async () => {
    const consent = await store.service.consent(authorization);
    expect(consent).toEqual({ client_id: app.client_id, name: 'Accounting', redirect_uri: authorization.redirect_uri, scopes: ['customers:read'] });
    expect(store.tables.get(OAuthClient)![0].secretHash).not.toBe(app.client_secret);
  });
  it('issues hashed tokens with PKCE and refuses authorization code reuse', async () => {
    const code = await authorize();
    const tokens = await exchange(code);
    expect(tokens.scope).toBe('customers:read');
    expect(await store.service.validateAccessToken(tokens.access_token)).toMatchObject({ id: merchant, scopes: ['customers:read'] });
    const stored = JSON.stringify(store.tables.get(OAuthCredential));
    for (const plaintext of [code, tokens.access_token, tokens.refresh_token]) expect(stored).not.toContain(plaintext);
    await expect(exchange(code)).rejects.toThrow('consumed');
  });
  it('rejects wrong PKCE, wrong redirects, scope escalation and wrong client secrets', async () => {
    const code = await authorize();
    await expect(exchange(code, 'b'.repeat(43))).rejects.toThrow('PKCE');
    await expect(store.service.consent({ ...authorization, redirect_uri: 'https://attacker.example/callback' })).rejects.toThrow('redirect URI');
    await expect(store.service.consent({ ...authorization, scope: 'customers:write' })).rejects.toThrow('scopes');
    await expect(store.service.exchange({ grant_type: 'authorization_code', client_id: app.client_id, client_secret: 'wrong', code })).rejects.toThrow('client');
  });
  it('rejects expired authorization codes', async () => {
    const code = await authorize();
    store.tables.get(OAuthCredential)![0].expiresAt = new Date(0);
    await expect(exchange(code)).rejects.toThrow('Expired');
  });
  it('rotates refresh tokens and immediately invalidates all grant tokens on revocation', async () => {
    const tokens = await exchange(await authorize());
    const request = { grant_type: 'refresh_token' as const, client_id: app.client_id, client_secret: app.client_secret, refresh_token: tokens.refresh_token };
    const rotated = await store.service.exchange(request);
    const separatelyApproved = await exchange(await authorize());
    expect(rotated.refresh_token).not.toBe(tokens.refresh_token);
    await expect(store.service.exchange(request)).rejects.toThrow('consumed');
    const [connection] = await store.service.connections(merchant);
    await expect(store.service.revoke(randomUUID(), connection.id)).rejects.toThrow('not found');
    await store.service.revoke(merchant, connection.id);
    await expect(store.service.validateAccessToken(tokens.access_token)).rejects.toThrow('revoked');
    await expect(store.service.validateAccessToken(rotated.access_token)).rejects.toThrow('revoked');
    await expect(store.service.validateAccessToken(separatelyApproved.access_token)).rejects.toThrow('revoked');
    await expect(store.service.exchange({ ...request, refresh_token: rotated.refresh_token })).rejects.toThrow('revoked');
  });
  it('denial preserves state and creates no grant', async () => {
    const result = await store.service.authorize(merchant, { ...authorization, approved: false });
    expect(new URL(result.redirectUrl).searchParams.get('error')).toBe('access_denied');
    expect(new URL(result.redirectUrl).searchParams.get('state')).toBe('opaque-state');
    expect(store.tables.get(OAuthGrant)).toHaveLength(0);
  });
  it('requires explicit route scopes and rejects access after app deactivation', async () => {
    expect(() => store.service.assertScopes(['customers:read'], undefined)).toThrow('scope');
    expect(() => store.service.assertScopes(['customers:read'], ['customers:write'])).toThrow('scope');
    const tokens = await exchange(await authorize());
    store.tables.get(OAuthClient)![0].isActive = false;
    await expect(store.service.validateAccessToken(tokens.access_token)).rejects.toThrow('revoked');
  });
  it('authenticates delegated JWT-guard routes while keeping unannotated management routes closed', async () => {
    const tokens = await exchange(await authorize());
    let scopes: string[] | undefined = ['customers:read'];
    const reflector = { getAllAndOverride: (key: string) => key === REQUIRE_SCOPE_KEY ? scopes : false };
    const guard = new JwtAuthGuard(reflector as any, store.service);
    const req: any = { headers: { authorization: `Bearer ${tokens.access_token}` } };
    const context: any = { switchToHttp: () => ({ getRequest: () => req }), getHandler: () => ({}), getClass: () => ({}) };
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.user.id).toBe(merchant);
    scopes = undefined;
    await expect(guard.canActivate(context)).rejects.toThrow('scope');
  });
});
