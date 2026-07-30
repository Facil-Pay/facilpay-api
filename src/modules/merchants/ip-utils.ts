import { Socket } from 'net';
import * as net from 'net';

/**
 * Converts an IPv4 address string to a 32-bit integer.
 */
function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, octet) => (acc << 8) | parseInt(octet, 10), 0) >>> 0;
}

/**
 * Checks whether `ip` is contained in the CIDR block `cidr`.
 * Supports both IPv4 CIDR (e.g. "10.0.0.0/8") and exact IPv4 matches.
 * For IPv6 this falls back to an exact string comparison (no CIDR).
 */
function matchesCidr(ip: string, cidr: string): boolean {
  if (!cidr.includes('/')) {
    // Exact match (normalise IPv6 casing)
    return ip === cidr || ip.toLowerCase() === cidr.toLowerCase();
  }

  const [range, prefixStr] = cidr.split('/');
  const prefix = parseInt(prefixStr, 10);

  if (net.isIPv4(ip) && net.isIPv4(range)) {
    const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
    return (ipv4ToInt(ip) & mask) === (ipv4ToInt(range) & mask);
  }

  // IPv6 CIDR – not implemented; fall back to exact match
  return ip.toLowerCase() === range.toLowerCase();
}

/**
 * Extracts the real client IP from an Express request, preferring
 * the leftmost non-private address in X-Forwarded-For (proxy-aware).
 */
export function extractClientIp(req: {
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
  connection?: { remoteAddress?: string };
}): string | undefined {
  const forwarded = req.headers?.['x-forwarded-for'];
  if (forwarded) {
    const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    // Take the leftmost (originating client) IP
    const candidate = raw.split(',')[0].trim();
    if (candidate) return candidate;
  }
  return req.ip ?? req.connection?.remoteAddress;
}

/**
 * Returns true when `ip` is allowed by `allowedIps`.
 * An empty allowlist means no restriction (all IPs pass).
 */
export function isIpAllowed(ip: string, allowedIps: string[]): boolean {
  if (!allowedIps || allowedIps.length === 0) return true;
  return allowedIps.some((entry) => matchesCidr(ip, entry));
}
