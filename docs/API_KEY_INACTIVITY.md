# Inactive API keys

GET /v1/merchants/me/settings returns apiKeyInactivityDays, which defaults to null (off). PATCH the same endpoint with { "apiKeyInactivityDays": 30 } to enable, or null to disable. Accepted periods are whole days from 8 through 3650 so a full seven-day warning fits within the policy.

The daily job uses the existing lastUsedAt timestamp. A key that has never been used counts from createdAt. Seven days before the inactivity deadline, the owner receives a warning email identifying the key prefix and scheduled revocation time. Keys already overdue when the policy is enabled receive a full seven-day grace period. SMTP failures leave the warning unmarked and retry on a later sweep; a key is never revoked without a successfully submitted warning.

Successful authentication updates lastUsedAt and clears the warning cycle. Changing or disabling the policy clears pending warning cycles. Revocation marks isActive false and writes api_key.revoked with actorType system and metadata.reason inactivity in the same database transaction. Key updates are serialized against revocation, and authentication cannot reactivate a key revoked concurrently.

Schema: migration 1795300000000-AddMerchantSecurityPolicies reverses both settings and warning columns. Existing expiry warnings remain separate. Coverage: api-key-inactivity.service.spec.ts and test/merchant-security.e2e-spec.ts. Tests and migration reversion were not executed during this edit-only task.
