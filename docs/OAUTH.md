# OAuth 2.0 third-party apps

OAuth uses the authorization code flow with mandatory S256 PKCE. Merchants
approve scopes using their authenticated session; apps receive opaque scoped
access and refresh tokens instead of merchant API keys.

| Method | Endpoint | Authentication / result |
| --- | --- | --- |
| POST | `/v1/oauth/apps` | Developer JWT; returns client ID and one-time client secret |
| GET | `/v1/oauth/consent` | Merchant JWT; returns validated consent screen data |
| POST | `/v1/oauth/authorize` | Merchant JWT; approves/denies and returns `redirectUrl` |
| POST | `/v1/oauth/token` | Client ID/secret plus authorization code or refresh token |
| GET | `/v1/oauth/connections` | Merchant JWT; lists connected apps |
| DELETE | `/v1/oauth/connections/:id` | Merchant JWT; revokes all grants for that merchant/app |

## Register an app

```json
{
  "name": "Accounting integration",
  "redirectUris": ["https://accounting.example.com/facilpay/callback"],
  "scopes": ["customers:read", "events:read", "webhooks:read", "webhooks:write"]
}
```

POST this body to `/v1/oauth/apps` with a developer JWT. Store the returned
`client_id` and `client_secret` securely on the app's server. Redirect URIs must
use HTTPS and have no fragment or embedded credentials. Authorization requires
an exact match with a registered URI. Client secrets are hashed at rest and
cannot be retrieved after registration.

## Consent and authorization

Generate a cryptographically random PKCE verifier of 43–128 characters using
the unreserved alphabet, then calculate:

```js
const { randomBytes, createHash } = require('node:crypto');
const verifier = randomBytes(32).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
```

The consent UI sends these query parameters to `GET /v1/oauth/consent` with the
merchant JWT: `response_type=code`, `client_id`, `redirect_uri`, `scope`
(space-separated), `code_challenge`, `code_challenge_method=S256`, and `state`.
Display the returned app name, redirect URI, and requested scopes to the merchant.

When the merchant decides, POST the same parameters as JSON to
`/v1/oauth/authorize`, adding `approved: true` or `false`. The UI navigates to
the returned `redirectUrl`. Approval adds a single-use code; denial adds
`error=access_denied`. State is preserved in either case. The app must generate
and verify its own random state to bind the callback to the initiating session.
Codes expire after five minutes.

## Exchange and refresh

`POST /v1/oauth/token` accepts JSON or `application/x-www-form-urlencoded`:

```json
{
  "grant_type": "authorization_code",
  "client_id": "<client UUID>",
  "client_secret": "<one-time app secret>",
  "code": "<callback code>",
  "redirect_uri": "https://accounting.example.com/facilpay/callback",
  "code_verifier": "<original verifier>"
}
```

The response includes `access_token`, `refresh_token`, `token_type: "Bearer"`,
`expires_in: 3600`, and the space-separated `scope`. Access tokens last one hour;
refresh tokens last 30 days. Send `Authorization: Bearer <access_token>` to
delegated endpoints. Token and authorization responses use `Cache-Control:
no-store` and `Pragma: no-cache`.

Refresh with `grant_type: "refresh_token"`, `client_id`, `client_secret`, and
`refresh_token`. Every successful refresh consumes the old refresh token and
returns a new pair. Persist the replacement before discarding the old one.
Codes and refresh tokens are consumed under a database transaction with row
locks to prevent concurrent reuse. Only SHA-256 hashes of codes and tokens are
stored. No access or refresh token plaintext is persisted.

## Scopes and revocation

Scopes use the same `resource:read`, `resource:write`, and `resource:admin`
grammar as granular API key scopes. Requested scopes must be a subset of those
registered by the app. A token receives only the scopes explicitly approved by
the merchant. Scopes are exact matches; `admin` does not implicitly grant other
actions.

The initial delegated endpoint coverage is:

| Endpoints | Required scopes |
| --- | --- |
| Customer list/detail | `customers:read` |
| Customer create/update/merge/delete | `customers:write` |
| Event list/detail | `events:read` |
| REST hook samples | `webhooks:read` |
| REST hook subscribe/unsubscribe | `webhooks:write` |
| Webhook list/stats/delivery logs | `webhooks:read` |
| Webhook create/update/delete/test | `webhooks:write` |

Routes without explicit delegation metadata remain merchant-session only,
including API-key management, app registration, consent, connections, portal
session creation, webhook secret rotation, and other account-management routes.
Additional routes can opt in with the shared `RequireScope` decorator after
their merchant-ownership enforcement has been reviewed.

Merchants list `/v1/oauth/connections` and DELETE the returned connection ID.
Revocation invalidates every authorization code, access token, and refresh token
for that merchant/app pair immediately for subsequent authentication checks,
including tokens issued under earlier approvals. Other merchants' connections
are unaffected. Revocation is checked from storage on each request, without a
token-validation cache. Reconnecting requires fresh consent.
