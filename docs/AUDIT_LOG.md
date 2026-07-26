# Audit Log System

## Overview

The audit log system provides an immutable record of sensitive and security-relevant operations in the FacilPay API. It is intended for compliance reviews, incident investigation, and operational troubleshooting.

> This document describes the planned audit log behavior and the public developer/admin workflow once the implementation is available.

## What Gets Audited

The system records audit events for the following areas:

- Authentication events
  - Login
  - Logout
  - Failed login attempts
- Payment operations
  - Payment creation
  - Refunds
  - Cancellations
- API key lifecycle events
  - API key creation
  - API key revocation
- Account security changes
  - Password changes
  - Two-factor authentication enablement/disablement
- Administrative actions
  - User deletion
  - Role changes

Each entry captures the actor, the action taken, the affected resource, the request context, and a small amount of structured metadata.

## What an Audit Entry Contains

Each audit log entry includes:

- `id`: unique identifier for the log entry
- `actorId`: the affected user or system actor, when available
- `actorType`: one of `user`, `api_key`, or `system`
- `action`: the action type being audited
- `resourceType`: the resource category involved
- `resourceId`: the specific resource instance, when available
- `ipAddress`: the originating IP address, when known
- `userAgent`: browser or client information, when known
- `metadata`: additional structured context for the event
- `timestamp`: the time the entry was created

Audit records are append-only and intended to be immutable after creation.

## Where Logs Are Stored

Audit logs are stored in a dedicated table in the primary application database, typically named `audit_logs`.

The storage design is intended to provide:

- A dedicated, append-only audit table
- Indexed fields for efficient filtering and lookup
- JSON-style metadata support for structured event context
- Retention controls so older entries can be removed according to policy

## Retention and Lifecycle

The system includes a retention mechanism so audit logs can be removed automatically after a configured period.

Operational expectations:

- Logs are retained according to the configured retention policy
- A scheduled retention job removes entries older than the allowed window
- The system should avoid deleting records manually except through the retention workflow

## How to Query Audit Logs

Audit logs are exposed through an admin-only API endpoint:

```http
GET /v1/admin/audit-logs
```

### Required Access

This endpoint is intended for administrators only and should require the same authentication and authorization flow used for other admin-only routes.

### Supported Filters

The query contract supports filters such as:

- `actorId`
- `actorType`
- `action`
- `resourceType`
- `resourceId`
- `ipAddress`
- `from`
- `to`

It should also support pagination so large audit sets can be reviewed safely.

### Example Request

```bash
curl -X GET "http://localhost:3000/v1/admin/audit-logs?page=1&limit=25&action=payment.refunded&from=2026-01-01T00:00:00Z" \
  -H "Authorization: Bearer <admin-token>"
```

### Example Response Shape

```json
{
  "data": [
    {
      "id": "a1b2c3d4",
      "actorId": "user-123",
      "actorType": "user",
      "action": "payment.refunded",
      "resourceType": "payment",
      "resourceId": "pay_456",
      "ipAddress": "203.0.113.5",
      "userAgent": "curl/8.0",
      "timestamp": "2026-07-26T10:15:00.000Z",
      "metadata": {
        "refundAmount": 2500,
        "currency": "USD"
      }
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 25
}
```

## Privacy and Security Notes

To keep audit data useful without exposing secrets:

- Sensitive values such as passwords, tokens, and API secrets should not be written into `metadata`
- Audit logs should be treated as sensitive operational records
- Access to the query endpoint should be limited to authorized administrators

## Developer Notes

When implementing the feature, the following concerns should be handled:

- Ensure all audit writes happen through a shared audit logging service
- Prefer structured metadata over free-form string messages
- Keep audit writes non-blocking where appropriate to avoid impacting core request latency
- Ensure audit records are never updated or deleted through normal application flows
