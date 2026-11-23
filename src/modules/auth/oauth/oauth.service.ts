import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import { OAuthClient, OAuthCredential, OAuthGrant } from './oauth.entity';
import { ApproveOAuthDto, OAuthAuthorizationDto, OAuthTokenDto, RegisterOAuthAppDto } from './oauth.dto';
import { UsersService } from '../../users/users.service';
import { GRANULAR_SCOPE_PATTERN } from '../../api-keys/scopes';

export const hashOAuthToken = (value: string) => createHash('sha256').update(value).digest('hex');
const opaque = (kind: string) => `fp_oauth_${kind}_${randomBytes(32).toString('base64url')}`;

@Injectable()
export class OAuthService {
  constructor(
    @InjectRepository(OAuthClient) private readonly clients: Repository<OAuthClient>,
    @InjectRepository(OAuthGrant) private readonly grants: Repository<OAuthGrant>,
    @InjectRepository(OAuthCredential) private readonly credentials: Repository<OAuthCredential>,
    private readonly dataSource: DataSource,
    private readonly users: UsersService,
  ) {}

  async register(developerId: string, dto: RegisterOAuthAppDto) {
    for (const uri of dto.redirectUris) {
      let url: URL;
      try { url = new URL(uri); } catch { throw new BadRequestException('Invalid redirect URI'); }
      if (url.protocol !== 'https:' || url.hash || url.username || url.password || uri.length > 2048) {
        throw new BadRequestException('Redirect URIs must use HTTPS without fragments or credentials');
      }
    }
    const secret = opaque('secret');
    const client = await this.clients.save(this.clients.create({ ...dto, developerId, secretHash: hashOAuthToken(secret), isActive: true }));
    return { client_id: client.id, client_secret: secret, name: client.name, redirectUris: client.redirectUris, scopes: client.scopes };
  }

  private async authorization(dto: OAuthAuthorizationDto) {
    const client = await this.clients.findOneBy({ id: dto.client_id, isActive: true });
    if (!client || !client.redirectUris.includes(dto.redirect_uri)) throw new BadRequestException('Invalid client or redirect URI');
    const scopes = [...new Set(dto.scope.split(' ').filter(Boolean))];
    if (!scopes.length || scopes.some((scope) => !GRANULAR_SCOPE_PATTERN.test(scope) || !client.scopes.includes(scope))) {
      throw new BadRequestException('Invalid requested scopes');
    }
    if (dto.response_type !== 'code' || dto.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(dto.code_challenge)) {
      throw new BadRequestException('Authorization code flow requires S256 PKCE');
    }
    return { client, scopes };
  }

  async consent(dto: OAuthAuthorizationDto) {
    const { client, scopes } = await this.authorization(dto);
    return { client_id: client.id, name: client.name, redirect_uri: dto.redirect_uri, scopes };
  }

  async authorize(merchantId: string, dto: ApproveOAuthDto) {
    const { client, scopes } = await this.authorization(dto);
    await this.users.assertMerchantActive(merchantId);
    const redirect = new URL(dto.redirect_uri);
    if (dto.state !== undefined) redirect.searchParams.set('state', dto.state);
    if (!dto.approved) {
      redirect.searchParams.set('error', 'access_denied');
      return { redirectUrl: redirect.toString() };
    }
    const code = opaque('code');
    await this.dataSource.transaction(async (manager) => {
      const grant = await manager.save(OAuthGrant, manager.create(OAuthGrant, { clientId: client.id, merchantId, scopes, revokedAt: null }));
      await manager.save(OAuthCredential, manager.create(OAuthCredential, {
        tokenHash: hashOAuthToken(code), kind: 'code', grantId: grant.id,
        expiresAt: new Date(Date.now() + 300_000), consumedAt: null,
        redirectUri: dto.redirect_uri, codeChallenge: dto.code_challenge,
      }));
    });
    redirect.searchParams.set('code', code);
    return { redirectUrl: redirect.toString() };
  }

  async exchange(dto: OAuthTokenDto) {
    const client = await this.clients.createQueryBuilder('client').addSelect('client.secretHash')
      .where('client.id = :id AND client.isActive = true', { id: dto.client_id }).getOne();
    const actual = Buffer.from(hashOAuthToken(dto.client_secret), 'hex');
    const expected = Buffer.from(client?.secretHash ?? '0'.repeat(64), 'hex');
    if (!timingSafeEqual(actual, expected) || !client) throw new UnauthorizedException('Invalid OAuth client');
    const kind = dto.grant_type === 'authorization_code' ? 'code' : 'refresh';
    const raw = kind === 'code' ? dto.code : dto.refresh_token;
    if (!raw) throw new BadRequestException('Missing code or refresh token');
    return this.dataSource.transaction(async (manager) => {
      // Lock the grant first in every mutation, including revoke, to serialize refresh and revocation.
      const candidate = await manager.findOneBy(OAuthCredential, { tokenHash: hashOAuthToken(raw), kind });
      if (!candidate) throw new UnauthorizedException('Invalid OAuth grant');
      const grant = await manager.findOne(OAuthGrant, { where: { id: candidate.grantId }, lock: { mode: 'pessimistic_write' } });
      const token = await manager.findOne(OAuthCredential, { where: { id: candidate.id }, lock: { mode: 'pessimistic_write' } });
      if (!grant || grant.clientId !== client.id || grant.revokedAt || !token || token.consumedAt || token.expiresAt.getTime() <= Date.now()) {
        throw new UnauthorizedException('Expired, consumed or revoked OAuth grant');
      }
      await this.users.assertMerchantActive(grant.merchantId);
      if (kind === 'code') {
        if (!dto.code_verifier || !/^[A-Za-z0-9._~-]{43,128}$/.test(dto.code_verifier) || token.redirectUri !== dto.redirect_uri ||
            createHash('sha256').update(dto.code_verifier).digest('base64url') !== token.codeChallenge) {
          throw new UnauthorizedException('Invalid redirect URI or PKCE verifier');
        }
      }
      token.consumedAt = new Date();
      await manager.save(OAuthCredential, token);
      return this.issue(manager, grant);
    });
  }

  private async issue(manager: EntityManager, grant: OAuthGrant) {
    const access = opaque('access');
    const refresh = opaque('refresh');
    for (const [kind, raw, lifetime] of [['access', access, 3600_000], ['refresh', refresh, 30 * 86400_000]] as const) {
      await manager.save(OAuthCredential, manager.create(OAuthCredential, {
        tokenHash: hashOAuthToken(raw), kind, grantId: grant.id,
        expiresAt: new Date(Date.now() + lifetime), consumedAt: null,
        redirectUri: null, codeChallenge: null,
      }));
    }
    return { access_token: access, refresh_token: refresh, token_type: 'Bearer', expires_in: 3600, scope: grant.scopes.join(' ') };
  }

  async validateAccessToken(raw: string) {
    const token = await this.credentials.findOneBy({ tokenHash: hashOAuthToken(raw), kind: 'access' });
    if (!token || token.expiresAt.getTime() <= Date.now() || token.consumedAt) throw new UnauthorizedException('Invalid OAuth access token');
    const grant = await this.grants.findOneBy({ id: token.grantId, revokedAt: IsNull() });
    if (!grant || !await this.clients.existsBy({ id: grant.clientId, isActive: true })) throw new UnauthorizedException('OAuth app was revoked');
    await this.users.assertMerchantActive(grant.merchantId);
    return { id: grant.merchantId, scopes: grant.scopes, oauthGrantId: grant.id };
  }

  assertScopes(granted: string[], required: string[] | undefined): void {
    // Management endpoints without explicit delegation metadata remain merchant-session only.
    if (!required?.length || !required.every((scope) => granted.includes(scope))) throw new ForbiddenException('Insufficient OAuth scope');
  }

  async connections(merchantId: string) {
    const grants = await this.grants.find({ where: { merchantId, revokedAt: IsNull() }, order: { createdAt: 'DESC' } });
    const latest = grants.filter((grant, index) => grants.findIndex((other) => other.clientId === grant.clientId) === index);
    return Promise.all(latest.map(async (grant) => {
      const client = await this.clients.findOneBy({ id: grant.clientId });
      const scopes = [...new Set(grants.filter((other) => other.clientId === grant.clientId).flatMap((other) => other.scopes))];
      return { id: grant.id, clientId: grant.clientId, name: client?.name, scopes, createdAt: grant.createdAt };
    }));
  }

  async revoke(merchantId: string, id: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const grant = await manager.findOne(OAuthGrant, { where: { id, merchantId }, lock: { mode: 'pessimistic_write' } });
      if (!grant) throw new NotFoundException('Connected app not found');
      // A merchant may have authorized the same app more than once.
      // Revoking that connection invalidates every grant for the merchant/app pair.
      await manager.update(OAuthGrant, { merchantId, clientId: grant.clientId }, { revokedAt: new Date() });
    });
  }
}
