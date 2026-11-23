# FacilPay API Documentation

Welcome to the FacilPay API documentation. This directory contains detailed guides for all features and conventions.

## Getting Started

- [Environment Configuration](./ENVIRONMENT.md) — Required and optional environment variables
- [Testing](./TESTING.md) — How to run and write unit and e2e tests
- [Database Migrations](./DATABASE_MIGRATIONS.md) — Creating and running migrations
- [API Conventions](./API_CONVENTIONS.md) — Pagination, filtering, sorting, and HTTP headers

## Core Features

### Payments and Transactions

- [Payments](./PAYMENT_VERIFICATION.md) — Creating and verifying payments
- [Payment Timeline](./PAYMENT_TIMELINE.md) — Payment lifecycle and state transitions
- [Refunds](./REFUNDS.md) — Issuing full and partial refunds
- [Disputes](./DISPUTES.md) — Handling payment disputes and chargebacks
- [Unmatched Transactions](./UNMATCHED_TRANSACTIONS.md) — Reconciling blockchain transactions

### Invoicing and Billing

- [Invoices](./INVOICES.md) — Standalone itemized invoices with PDF generation
- [Invoice Reminders](./INVOICE_REMINDERS.md) — Automated overdue invoice reminders
- [Payment Links](./PAYMENT_LINKS.md) — Shareable payment links without invoices
- [Checkout Sessions](./CHECKOUT_SESSIONS.md) — Embedded checkout flow
- [Checkout Analytics](./CHECKOUT_SESSIONS_ANALYTICS.md) — Session conversion tracking

### Recurring Billing and Subscriptions

- [Recurring Payments](./RECURRING_PAYMENTS.md) — Subscription plans and cycles
- [Coupons](./COUPONS.md) — Discount codes and promotions

### Customers and Products

- [Customers](./CUSTOMERS.md) — Managing customer records
- [Rates](./RATES.md) — Products and pricing (legacy, see also Coupons)

### Payouts and Settlements

- [Settlements](./SETTLEMENTS.md) — Batch payouts to merchants
- [Payouts and Balance History](./payouts-and-balance-history.md) — Merchant balance tracking
- [Ledger](./LEDGER.md) — Double-entry accounting ledger

### Stellar Integration

- [Stellar](./STELLAR.md) — Stellar blockchain integration overview
- [SEP-24 Anchors](./SEP24_ANCHORS.md) — Stellar anchor protocol support
- [Payment Splits](./PAYMENT_SPLITS.md) — Multi-party payment distribution

## Authentication and Security

- [Sessions](./SESSIONS.md) — User authentication and session management
- [Two-Factor Authentication](./TWO_FACTOR_AUTH.md) — TOTP and backup codes
- [WebAuthn](./WEBAUTHN.md) — Passwordless authentication with hardware keys
- [Password Reset](./PASSWORD_RESET.md) — Secure password recovery flow
- [Login Security Alerts](./LOGIN_SECURITY_ALERTS.md) — Login anomaly detection
- [API Keys](./API_KEYS.md) — Programmatic API access

### Access Control

- [RBAC](./RBAC.md) — Role-based access control
- [Merchant Access Controls](./MERCHANT_ACCESS_CONTROLS.md) — Team member permissions

## Integrations and Webhooks

- [Webhooks](./WEBHOOKS.md) — Event notifications to merchant endpoints
- [Webhook Health](./webhook-health-and-passwordless.md) — Monitoring webhook delivery
- [Events](./EVENTS.md) — Event types and payloads
- [Notifications](./NOTIFICATIONS.md) — Email and in-app notifications

## Configuration and Customization

- [Merchant Branding](./MERCHANT_BRANDING.md) — Custom logos and colors
- [Merchant Rate Limiting](./MERCHANT_RATE_LIMITING.md) — Per-merchant API throttling
- [Onboarding](./ONBOARDING.md) — Merchant onboarding flow

## Operations and Monitoring

- [Health Checks](./HEALTH_CHECKS.md) — Service health endpoints
- [Observability](./OBSERVABILITY.md) — Logging, metrics, and tracing
- [Audit Log](./AUDIT_LOG.md) — User action auditing
- [Exports](./EXPORTS.md) — Data export for compliance (GDPR)

## Platform Features

- [Idempotency](./IDEMPOTENCY.md) — Safe request retries with idempotency keys

## Need Help?

- Browse the files above for detailed feature documentation
- Check [API Conventions](./API_CONVENTIONS.md) for common patterns
- See [TESTING.md](./TESTING.md) for testing guidelines
- Refer to the main [README.md](../README.md) for project setup

All endpoint examples use placeholder API keys. Replace `sk_test_xxx` with your actual test key.
