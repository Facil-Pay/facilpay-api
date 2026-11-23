# Merchant Access Controls: IP Allowlisting & Geo-Restrictions

## Overview

FacilPay provides merchants with multi-layered perimeter security controls:

1. **IP Allowlisting**: Restrict API access to designated IPv4, IPv6, and CIDR subnets.
2. **Geo-Restrictions**: Allow or block payments based on the payer's geolocated country.
3. **Reverse Proxy Trust Model**: Secure client IP resolution through configured upstream proxies and load balancers (`TRUSTED_PROXY_IPS` / `TRUSTED_PROXIES`).

---

## 1. IP Allowlist

The IP allowlist restricts which network addresses can make authenticated merchant API calls. When configured, any request originating from an IP outside the allowlist is rejected immediately with `403 Forbidden` before business logic executes.

### Supported Address Formats

- **IPv4 Individual Addresses**: e.g., `198.51.100.1`
- **IPv4 CIDR Blocks**: e.g., `198.51.100.0/24`, `10.0.0.0/8`
- **IPv6 Individual Addresses**: e.g., `2001:db8::1`
- **IPv6 CIDR Blocks**: e.g., `2001:db8::/32`, `fe80::/64`
- **IPv4-Mapped IPv6**: Addresses formatted like `::ffff:198.51.100.1` are automatically normalized to IPv4 `198.51.100.1` during comparison.

### Empty Allowlist Behavior

- An empty array `[]` (or unconfigured state) disables IP restrictions completely, allowing requests from any IP.
- Submitting `{"allowedIps": []}` clears all existing restrictions.

### Blocked Response Format

When a request fails the allowlist check, the API returns HTTP `403 Forbidden`:

```json
{
  "statusCode": 403,
  "message": "Access denied: IP address 203.0.113.45 is not in the merchant's allowlist",
  "error": "Forbidden",
  "code": "ip_not_allowed"
}
```

---

## 2. API Endpoints

All endpoints require JWT Bearer Authentication (`Authorization: Bearer <token>`).

### 2.1 Update IP Allowlist

`PATCH /v1/merchants/me/ip-allowlist`

Sets or updates the list of permitted IPs and CIDR subnets.

**Request:**

```http
PATCH /v1/merchants/me/ip-allowlist HTTP/1.1
Host: api.facilpay.io
Authorization: Bearer eyJhbGciOi...
Content-Type: application/json

{
  "allowedIps": [
    "198.51.100.10",
    "203.0.113.0/24",
    "2001:db8:85a3::/48"
  ]
}
```

**Response (HTTP 200 OK):**

```json
{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "merchantId": "abc123-merchant-uuid",
  "allowedIps": ["198.51.100.10", "203.0.113.0/24", "2001:db8:85a3::/48"],
  "createdAt": "2026-01-26T10:00:00.000Z",
  "updatedAt": "2026-01-26T10:00:00.000Z"
}
```

### 2.2 Get Current IP Allowlist

`GET /v1/merchants/me/ip-allowlist`

Retrieves the currently configured IP allowlist for the authenticated merchant.

**Request:**

```http
GET /v1/merchants/me/ip-allowlist HTTP/1.1
Host: api.facilpay.io
Authorization: Bearer eyJhbGciOi...
```

**Response (HTTP 200 OK):**

```json
{
  "merchantId": "abc123-merchant-uuid",
  "allowedIps": ["198.51.100.10", "203.0.113.0/24", "2001:db8:85a3::/48"]
}
```

### 2.3 Configure Geographic Restrictions

`PATCH /v1/merchants/me/geo-restrictions`

Configures country-level allowlists or blocklists for incoming customer payments.

**Request:**

```http
PATCH /v1/merchants/me/geo-restrictions HTTP/1.1
Host: api.facilpay.io
Authorization: Bearer eyJhbGciOi...
Content-Type: application/json

{
  "allowedCountries": ["US", "CA", "GB", "NG"],
  "blockedCountries": null,
  "bypassInTestMode": true
}
```

**Response (HTTP 200 OK):**

```json
{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "merchantId": "abc123-merchant-uuid",
  "allowedCountries": ["US", "CA", "GB", "NG"],
  "blockedCountries": null,
  "bypassInTestMode": true,
  "createdAt": "2026-01-26T10:00:00.000Z",
  "updatedAt": "2026-01-26T10:00:00.000Z"
}
```

---

## 3. Geographic Restrictions (Payment Enforcement)

Geo-restrictions guard payment submission routes by evaluating the customer's remote IP address against MaxMind GeoIP database lookups (`geoip-lite`).

### Allowlist vs. Blocklist Logic

1. **Allowed Countries (`allowedCountries`)**:
   - If set to a non-empty array of ISO 3166-1 alpha-2 codes (e.g. `["US", "GB"]`), payments are ONLY accepted from these countries.
   - Any payment originating from a country not in this list is rejected.
2. **Blocked Countries (`blockedCountries`)**:
   - If set to a non-empty array of codes (e.g. `["KP", "IR"]`), payments from these countries are strictly forbidden.
3. **Precedence**:
   - If both `allowedCountries` and `blockedCountries` are configured, the customer IP must be present in `allowedCountries` AND NOT present in `blockedCountries`.
4. **Test Mode Bypass (`bypassInTestMode`)**:
   - When set to `true`, testnet/mock payment transactions skip geographic enforcement, allowing local development and QA testing from any location.

### GeoIP Lookup & In-Memory LRU Cache

- Country lookups resolve via `geoip-lite` with an internal LRU cache (`GeoLookupService`) configured via:
  - `GEO_LOOKUP_CACHE_MAX_SIZE`: Maximum cached entries (default: `1000`).
  - `GEO_LOOKUP_CACHE_TTL_SECONDS`: Cache duration per IP (default: `300` seconds / 5 minutes).
  - `GEO_LOOKUP_EVICTION_INTERVAL_MS`: Periodic background cleanup interval (default: `60000` ms).
- **Limitations**:
  - VPNs, Tor exit nodes, and commercial proxies can disguise the payer's actual location.
  - Private / unroutable IP addresses (e.g., `127.0.0.1`, `10.0.0.0/8`, `192.168.0.0/16`) return `null` and do not trigger geo-blocks.

### Blocked Response Format

```json
{
  "statusCode": 403,
  "message": "Payments from NG are not permitted by this merchant",
  "error": "Forbidden",
  "code": "geo_restricted"
}
```

---

## 4. Reverse Proxy & Trusted Proxy Resolution

In production deployments behind load balancers (AWS ALB, Cloudflare, Nginx, or Kubernetes Ingress), the connecting peer address seen by Node.js is often the internal load balancer, not the merchant or payer.

FacilPay implements secure IP extraction using the `TRUSTED_PROXY_IPS` environment variable.

### How Client IP is Resolved

1. **Untrusted Connection**:
   - If the direct connecting socket address (`req.socket.remoteAddress`) is **not** in `TRUSTED_PROXY_IPS`, the socket address is treated as the client IP.
   - Any incoming `X-Forwarded-For` header is ignored to prevent client IP spoofing.
2. **Trusted Connection**:
   - If the direct connecting socket address matches `TRUSTED_PROXY_IPS` (exact IP or CIDR), FacilPay inspects the `X-Forwarded-For` header.
   - The header chain is traversed from **right to left**, skipping all intermediate trusted proxy entries.
   - The first non-trusted address encountered is identified as the legitimate client IP.

### Example Configuration:

```env
# Comma-separated list of upstream proxy IPs or CIDR blocks
TRUSTED_PROXY_IPS=10.0.0.0/8,172.16.0.0/12,192.168.1.1
```

---

## 5. How to Avoid Locking Yourself Out

Misconfiguring the IP allowlist will immediately block your server and API keys from communicating with the FacilPay API. Follow these best practices:

1. **Verify Your Outbound Static IP First**:
   - Query your server's public IP from your command line:
     ```bash
     curl -s https://checkip.amazonaws.com
     ```
   - Ensure the IP matches what you configure in `allowedIps`.

2. **Always Include CIDR Subnets for Cloud Deployments**:
   - If your application runs on cloud infrastructure with ephemeral IP pools (e.g. AWS ECS, Heroku, Vercel), allow the provider's entire NAT gateway CIDR range rather than a single ephemeral IP.

3. **Keep an Emergency Admin Access Route**:
   - Keep a secondary developer workstation IP or VPN gateway in the `allowedIps` array.

4. **Recovering from a Lockout**:
   - If you lock your service out, submit a `PATCH /v1/merchants/me/ip-allowlist` with `{"allowedIps": []}` from the FacilPay Web Merchant Dashboard (which authenticates through session cookies rather than the API allowlist).


## Merchant security policies

GET and PATCH /v1/merchants/me/settings expose apiKeyInactivityDays (null by default) and require2fa (false by default). See [API key inactivity](API_KEY_INACTIVITY.md) and [team 2FA](TWO_FACTOR_AUTH.md) for enrollment, notifications and revocation behavior.

Enterprise teams can configure [SAML SSO](SAML_SSO.md) with per-merchant IdP metadata XML, an email domain, JIT role, and optional mandatory SSO. Developers can inspect [redacted API request logs](REQUEST_LOGS.md) for the last 30 days.
