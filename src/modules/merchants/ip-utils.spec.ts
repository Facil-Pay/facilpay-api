import { isIpAllowed, extractClientIp } from './ip-utils';

describe('isIpAllowed', () => {
  it('returns true when allowedIps is empty (no restriction)', () => {
    expect(isIpAllowed('1.2.3.4', [])).toBe(true);
  });

  it('returns true for an exact IPv4 match', () => {
    expect(isIpAllowed('1.2.3.4', ['1.2.3.4'])).toBe(true);
  });

  it('returns false when IPv4 is not in the list', () => {
    expect(isIpAllowed('1.2.3.5', ['1.2.3.4'])).toBe(false);
  });

  it('matches an IP inside an IPv4 CIDR range', () => {
    expect(isIpAllowed('10.0.0.5', ['10.0.0.0/8'])).toBe(true);
  });

  it('rejects an IP outside an IPv4 CIDR range', () => {
    expect(isIpAllowed('11.0.0.1', ['10.0.0.0/8'])).toBe(false);
  });

  it('matches the network address of a /24 CIDR', () => {
    expect(isIpAllowed('192.168.1.0', ['192.168.1.0/24'])).toBe(true);
  });

  it('matches the broadcast address of a /24 CIDR', () => {
    expect(isIpAllowed('192.168.1.255', ['192.168.1.0/24'])).toBe(true);
  });

  it('rejects an IP just outside a /24 CIDR', () => {
    expect(isIpAllowed('192.168.2.1', ['192.168.1.0/24'])).toBe(false);
  });

  it('matches when one of multiple entries covers the IP', () => {
    expect(isIpAllowed('172.16.0.1', ['10.0.0.0/8', '172.16.0.0/12'])).toBe(true);
  });

  it('handles a /32 CIDR as an exact match', () => {
    expect(isIpAllowed('5.6.7.8', ['5.6.7.8/32'])).toBe(true);
    expect(isIpAllowed('5.6.7.9', ['5.6.7.8/32'])).toBe(false);
  });

  it('matches exact IPv6 address (case-insensitive)', () => {
    expect(isIpAllowed('2001:DB8::1', ['2001:db8::1'])).toBe(true);
  });
});

describe('extractClientIp', () => {
  it('returns the first IP from X-Forwarded-For', () => {
    const req = { headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }, ip: '127.0.0.1' };
    expect(extractClientIp(req)).toBe('1.2.3.4');
  });

  it('falls back to req.ip when no X-Forwarded-For', () => {
    const req = { headers: {}, ip: '9.8.7.6' };
    expect(extractClientIp(req)).toBe('9.8.7.6');
  });

  it('falls back to connection.remoteAddress when no ip and no header', () => {
    const req = { headers: {}, connection: { remoteAddress: '4.3.2.1' } };
    expect(extractClientIp(req)).toBe('4.3.2.1');
  });

  it('handles X-Forwarded-For as an array', () => {
    const req = { headers: { 'x-forwarded-for': ['3.3.3.3, 4.4.4.4'] }, ip: '127.0.0.1' };
    expect(extractClientIp(req)).toBe('3.3.3.3');
  });
});
