import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource, LessThan, MoreThan } from 'typeorm';
import { SAML, ValidateInResponseTo, type Profile } from '@node-saml/node-saml';
import { DOMParser } from '@xmldom/xmldom';
import { createHash, randomBytes } from 'crypto';
import { hash } from 'bcrypt';
import { MerchantSamlConfig } from './entities/merchant-saml-config.entity';
import { SamlState } from './entities/saml-state.entity';
import { ConfigureSamlDto, SamlCallbackDto } from './dto/saml.dto';
import { parseIdpMetadata } from './saml-metadata';
import { MerchantMember, TeamRole } from '../team/entities/merchant-member.entity';
import { User } from '../users/user.entity';
import { AuditLog } from '../audit-logs/audit-log.entity';
import { AuthService } from './auth.service';

@Injectable()
export class SamlService {
  constructor(private readonly db: DataSource, private readonly config: ConfigService, private readonly auth: AuthService) {}

  private urls(merchantId: string) {
    const origin = this.config.get<string>('SAML_PUBLIC_URL');
    if (!origin || new URL(origin).protocol !== 'https:') throw new BadRequestException('SAML_PUBLIC_URL must be an HTTPS public API origin');
    const base = origin.replace(/\/$/, '') + '/v1/auth/saml/' + merchantId;
    return { callbackUrl: base + '/acs', issuer: base + '/metadata' };
  }

  async configure(merchantId: string, dto: ConfigureSamlDto) {
    parseIdpMetadata(dto.metadataXml);
    this.urls(merchantId);
    const repo = this.db.getRepository(MerchantSamlConfig);
    const existing = await repo.findOneBy({ merchantId });
    if (dto.requireSso !== undefined && typeof dto.requireSso !== 'boolean') throw new BadRequestException('requireSso must be boolean');
    const config = repo.create({ merchantId, domain: dto.domain.trim().toLowerCase(), metadataXml: dto.metadataXml,
      requireSso: dto.requireSso ?? existing?.requireSso ?? false,
      defaultRole: dto.defaultRole ?? existing?.defaultRole ?? TeamRole.VIEWER });
    try { await repo.save(config); }
    catch (error) {
      if ((error as { code?: string }).code === '23505') throw new ConflictException('This email domain is already configured for another merchant');
      throw error;
    }
    return this.publicConfig(config);
  }

  publicConfig(config: MerchantSamlConfig) {
    return { merchantId: config.merchantId, domain: config.domain, requireSso: config.requireSso,
      defaultRole: config.defaultRole, ...this.urls(config.merchantId) };
  }

  async load(merchantId: string) {
    const config = await this.db.getRepository(MerchantSamlConfig).findOneBy({ merchantId });
    if (!config) throw new NotFoundException('SAML is not configured');
    return config;
  }

  private client(config: MerchantSamlConfig, requireRequest = false) {
    const metadata = parseIdpMetadata(config.metadataXml);
    const states = this.db.getRepository(SamlState);
    const cacheKey = (id: string) => createHash('sha256').update(config.merchantId + ':request:' + id).digest('hex');
    return new SAML({
      ...this.urls(config.merchantId), entryPoint: metadata.entryPoint, idpIssuer: metadata.issuer,
      idpCert: metadata.certificates, audience: this.urls(config.merchantId).issuer,
      wantAssertionsSigned: true, wantAuthnResponseSigned: true,
      signatureAlgorithm: 'sha256', digestAlgorithm: 'sha256',
      acceptedClockSkewMs: 0, maxAssertionAgeMs: 300000, requestIdExpirationPeriodMs: 300000,
      validateInResponseTo: requireRequest ? ValidateInResponseTo.always : ValidateInResponseTo.ifPresent,
      cacheProvider: {
        saveAsync: async (key, value) => {
          const now = Date.now();
          await states.insert({ id: cacheKey(key), merchantId: config.merchantId, value, expiresAt: new Date(now + 300000) });
          return { value, createdAt: now };
        },
        getAsync: async key => (await states.findOneBy({ id: cacheKey(key), merchantId: config.merchantId, expiresAt: MoreThan(new Date()) }))?.value ?? null,
        removeAsync: async key => {
          if (!key) return null;
          const entry = await states.findOneBy({ id: cacheKey(key), merchantId: config.merchantId });
          await states.delete({ id: cacheKey(key), merchantId: config.merchantId });
          return entry?.value ?? null;
        },
      },
    });
  }

  async metadata(merchantId: string) { return this.client(await this.load(merchantId)).generateServiceProviderMetadata(null, null); }

  async start(merchantId: string) {
    const config = await this.load(merchantId);
    const relay = randomBytes(24).toString('hex');
    await this.db.getRepository(SamlState).insert({ id: relay, merchantId, value: 'relay', expiresAt: new Date(Date.now() + 300000) });
    return this.client(config).getAuthorizeUrlAsync(relay, undefined, {});
  }

  async callback(merchantId: string, body: SamlCallbackDto, ip?: string, userAgent?: string) {
    const config = await this.load(merchantId);
    if (body.RelayState) {
      const relay = await this.db.getRepository(SamlState).findOneBy({ id: body.RelayState, merchantId, value: 'relay', expiresAt: MoreThan(new Date()) });
      if (!relay) throw new UnauthorizedException('Invalid SSO state');
    }
    let profile: Profile;
    try {
      const result = await this.client(config, !!body.RelayState).validatePostResponseAsync({ SAMLResponse: body.SAMLResponse });
      const verified = result.profile;
      if (!verified || result.loggedOut || verified.issuer !== parseIdpMetadata(config.metadataXml).issuer) throw Error();
      profile = verified;
    } catch { throw new UnauthorizedException('Invalid SAML response'); }
    const email = String(profile.email ?? profile.nameID ?? '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+$/.test(email) || email.split('@')[1] !== config.domain) throw new ForbiddenException('Email domain does not match this merchant');
    // Inspect only the assertion XML covered by the verified signature.
    if (!profile.getAssertionXml) throw new UnauthorizedException('Signed assertion is required');
    const assertion = new DOMParser().parseFromString(profile.getAssertionXml(), 'text/xml').documentElement;
    const assertionId = assertion.getAttribute('ID');
    const confirmation = assertion.getElementsByTagNameNS('urn:oasis:names:tc:SAML:2.0:assertion', 'SubjectConfirmationData');
    if (confirmation.length !== 1 || confirmation.item(0)?.getAttribute('Recipient') !== this.urls(merchantId).callbackUrl) {
      throw new UnauthorizedException('Invalid SAML recipient');
    }
    const response = new DOMParser().parseFromString(Buffer.from(body.SAMLResponse, 'base64').toString('utf8'), 'text/xml').documentElement;
    if (response.getAttribute('Destination') !== this.urls(merchantId).callbackUrl) throw new UnauthorizedException('Invalid SAML destination');
    const conditions = assertion.getElementsByTagNameNS('urn:oasis:names:tc:SAML:2.0:assertion', 'Conditions');
    const expires = conditions.item(0)?.getAttribute('NotOnOrAfter');
    if (!assertionId || !expires || !Number.isFinite(Date.parse(expires)) || Date.parse(expires) <= Date.now()) throw new UnauthorizedException('Assertion expiry is required');
    const replayId = createHash('sha256').update(merchantId + ':assertion:' + assertionId).digest('hex');
    const user = await this.db.transaction(async manager => {
      // Unique insert rejects both sequential and concurrent assertion replays across workers.
      try { await manager.getRepository(SamlState).insert({ id: replayId, merchantId, value: 'assertion', expiresAt: new Date(Math.max(Date.parse(expires), Date.now() + 600000)) }); }
      catch { throw new UnauthorizedException('SAML assertion already used'); }
      const owner = await manager.getRepository(User).findOneBy({ id: merchantId });
      if (!owner?.isActive || owner.deletedAt || owner.status === 'SUSPENDED') throw new ForbiddenException('Merchant is unavailable');
      let user = await manager.getRepository(User).findOneBy({ email });
      const members = manager.getRepository(MerchantMember);
      if (user) {
        if (user.id !== merchantId && !await members.existsBy({ merchantId, userId: user.id })) {
          throw new ForbiddenException('Existing accounts must accept a team invitation before SSO');
        }
      } else {
        user = await manager.getRepository(User).save(manager.getRepository(User).create({
          email, password: await hash(randomBytes(48).toString('hex'), 12), isEmailVerified: true,
        }));
        await members.insert({ merchantId, userId: user.id, invitedBy: merchantId, role: config.defaultRole, joinedAt: new Date() });
      }
      if (!user.isActive || user.deletedAt || user.status === 'SUSPENDED' || !user.isEmailVerified || user.passwordResetRequired || (user.lockedUntil && user.lockedUntil > new Date())) throw new ForbiddenException('Account is unavailable');
      if (body.RelayState) await manager.getRepository(SamlState).delete({ id: body.RelayState, merchantId });
      await manager.getRepository(AuditLog).save({ actorId: user.id, actorType: 'user', action: 'auth.sso.success', resourceType: 'user', resourceId: user.id, metadata: { merchantId } });
      return user;
    });
    return this.auth.completeSsoLogin(user, ip, userAgent);
  }

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async prune() { await this.db.getRepository(SamlState).delete({ expiresAt: LessThan(new Date()) }); }
}
