import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';
import { AuthService } from './auth.service';
import { MerchantSecurityService } from '../merchants/merchant-security.service';
import type { Request } from 'express';
describe('JWT security policy enforcement', () => {
  const request = { method: 'GET', path: '/v1/payments' } as Request;
  it('rejects setup and challenge tokens as access tokens', async () => {
    const auth = { validateUser: jest.fn() };
    const security = { enforce: jest.fn() };
    const strategy = new JwtStrategy(new ConfigService({ JWT_SECRET: 'test' }), auth as unknown as AuthService, security as unknown as MerchantSecurityService);
    await expect(strategy.validate(request, { sub: 'user', purpose: 'two-factor-login' })).rejects.toThrow('access token');
    expect(auth.validateUser).not.toHaveBeenCalled();
  });
  it('applies team restrictions to authenticated users', async () => {
    const security = { enforce: jest.fn().mockRejectedValue(new Error('setup required')) };
    const strategy = new JwtStrategy(new ConfigService({ JWT_SECRET: 'test' }), { validateUser: async () => ({ id: 'user' }) } as unknown as AuthService, security as unknown as MerchantSecurityService);
    await expect(strategy.validate(request, { sub: 'user' })).rejects.toThrow('setup required');
    expect(security.enforce).toHaveBeenCalledWith('user', 'GET', '/v1/payments');
  });
});
