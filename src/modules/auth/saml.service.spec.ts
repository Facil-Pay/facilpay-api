import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { SamlService } from './saml.service';
import { AuthService } from './auth.service';
import { parseIdpMetadata } from './saml-metadata';
import { SecurityStore } from '../../../test/helpers/security-store';
import { mockSamlIdp } from '../../../test/helpers/mock-saml-idp';
import { TeamRole } from '../team/entities/merchant-member.entity';
import { MerchantMember } from '../team/entities/merchant-member.entity';
import { User } from '../users/user.entity';
import { MerchantSamlConfig } from './entities/merchant-saml-config.entity';
describe('SAML service configuration', () => {
  it('rejects metadata with entities and non-IdP XML', () => {
    expect(() => parseIdpMetadata('<!DOCTYPE foo><foo/>')).toThrow('Unsafe');
    expect(() => parseIdpMetadata('<foo/>')).toThrow('Invalid');
  });
  it('persists the configured default role and exposes only public configuration', async () => {
    const db = new SecurityStore(); const idp = mockSamlIdp();
    const service = new SamlService(db as unknown as DataSource, new ConfigService({ SAML_PUBLIC_URL: 'https://api.example.com' }), {} as AuthService);
    const result = await service.configure('merchant', { metadataXml: idp.metadata, domain: 'EXAMPLE.COM', requireSso: true, defaultRole: TeamRole.DEVELOPER });
    expect(result).toMatchObject({ domain: 'example.com', requireSso: true, defaultRole: TeamRole.DEVELOPER });
    expect(result).not.toHaveProperty('metadataXml');
    expect(db.rows(MerchantSamlConfig)[0].metadataXml).toBe(idp.metadata);
  });
  it('blocks password and standalone passkey login for SSO-required members', async () => {
    const db = new SecurityStore();
    db.rows(MerchantMember).push({ merchantId: 'owner', userId: 'member' });
    db.rows(MerchantSamlConfig).push({ merchantId: 'owner', requireSso: true });
    const user = new User({ id: 'member', isEmailVerified: true });
    const auth = Object.create(AuthService.prototype) as AuthService;
    Object.assign(auth, { dataSource: db, usersService: { findByEmail: async () => user, findByIdWithSecrets: async () => user, isAccountLocked: () => false } });
    await expect(auth.login({ email: 'member@example.com', password: 'password' })).rejects.toThrow('requires SAML SSO');
    await expect(auth.completePasskeyLogin('member')).rejects.toThrow('requires SAML SSO');
    await expect(auth.completeOAuthLogin('member')).rejects.toThrow('requires SAML SSO');
  });

  it('requires a secure, operator-configured public origin', async () => {
    const service = new SamlService(new SecurityStore() as unknown as DataSource, new ConfigService(), {} as AuthService);
    await expect(service.configure('merchant', { domain: 'example.com', metadataXml: mockSamlIdp().metadata })).rejects.toThrow('SAML_PUBLIC_URL');
  });
});
