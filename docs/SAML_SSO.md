# Merchant SAML SSO

Set SAML_PUBLIC_URL to the public HTTPS API origin (for example https://api.facilpay.com). The SP entity ID and assertion consumer URL are derived from that operator-controlled origin, never request headers.

Owners configure SAML using PUT /v1/auth/saml/configuration with a normal Bearer access token:

```json
{
  "domain": "example.com",
  "metadataXml": "<EntityDescriptor ...>...</EntityDescriptor>",
  "defaultRole": "VIEWER",
  "requireSso": false
}
```

Supply the IdP's downloaded metadata XML. Server-side metadata URL fetching is not implemented. Metadata must describe one IdP, include a signing certificate, and expose an HTTPS HTTP-Redirect login service. Entity declarations and DTDs are rejected. GET /v1/auth/saml/configuration returns public configuration including issuer and callbackUrl. Configure the IdP with those exact URLs. Signing-certificate rotation is handled by uploading replacement metadata; multiple signing certificates in metadata are supported.

- GET /v1/auth/saml/:merchantId/metadata: SP metadata.
- GET /v1/auth/saml/:merchantId/login: redirect for SP-initiated login.
- POST /v1/auth/saml/:merchantId/acs: form-encoded SAMLResponse and optional RelayState; accepts SP- and IdP-initiated responses.

Configure the IdP to sign both the response and assertion using SHA-256 or stronger, issue short-lived assertions, and supply an email NameID or email attribute matching the configured domain exactly. Signatures, issuer, audience, timestamps, destination, and recipient are checked. Assertions must have an explicit expiry. SP request correlation and assertion replay records are persisted so multiple API workers share validation state. Old state is pruned daily.

A successful callback creates a normal sessions-module session, access token, and refresh token through the shared login flow. The callback returns JSON with Cache-Control: no-store; the integrating frontend must handle the tokens securely. There are no token-bearing URL redirects.

New identities are provisioned just in time with the configured default team role (VIEWER by default), a verified email, and an unguessable password. Existing users must already belong to this merchant or accept an invitation first; SSO does not silently link unrelated accounts by matching email. Existing membership roles are preserved. Suspended, deleted, locked and otherwise unavailable accounts are rejected.

Setting requireSso true disables password and standalone passkey login for the owner and members of that team. This affects new interactive logins; it does not revoke existing sessions or API keys. Team require2fa remains independent: SSO does not count as local 2FA enrollment, so unenrolled users must use the setup endpoints if required.

Schema: migration 1795300000002-CreateMerchantSaml has matching up/down methods. Unit coverage: saml.service.spec.ts. HTTP coverage: test/saml.e2e-spec.ts uses an ephemeral signing mock IdP and tests SP/IdP flows, invalid signatures, audience, expiry, recipient, domain and replay.

Dependencies were declared in package.json but were not installed and package-lock.json was not regenerated, per the edit-only request. Installation/lockfile refresh, compilation, tests, migration application and migration reversion remain unverified.

Validation library: [Node-SAML](https://github.com/node-saml/node-saml), with [XML Crypto](https://github.com/node-saml/xml-crypto) for the test IdP.
