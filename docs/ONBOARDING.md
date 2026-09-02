# Merchant Onboarding

This document describes the merchant onboarding review flow implemented in the `onboarding` module.

## Overview

Merchants submit business information and supporting documents through the public onboarding endpoints. An admin reviews the submission and approves or rejects it. The first call to `GET /v1/onboarding/status` automatically creates a `pending` onboarding record if one does not already exist.

## Onboarding Statuses

| Status | Description |
|---|---|
| `pending` | Record created; merchant may submit business info and documents. |
| `under_review` | Submission is being reviewed by an admin. |
| `approved` | Onboarding accepted; merchant can use FacilPay merchant features. |
| `rejected` | Onboarding rejected; `rejectionReason` contains the explanation. |

## Endpoints

### Submit business information

```http
POST /v1/onboarding/business-info
Authorization: Bearer <token>
Content-Type: application/json
```

Request body:

```json
{
  "businessName": "Acme Inc",
  "businessEmail": "ops@acme.example",
  "businessAddress": "Lagos, Nigeria"
}
```

- `businessName` and `businessEmail` are required.
- `businessAddress` is optional.
- Creates the onboarding record if it does not exist and sets the status to `pending`.

### Submit documents

```http
POST /v1/onboarding/documents
Authorization: Bearer <token>
Content-Type: application/json
```

Request body:

```json
{
  "idDocumentUrl": "https://cdn.example.com/id.jpg",
  "businessCertificateUrl": "https://cdn.example.com/cert.pdf"
}
```

- Both URLs are required and must be valid URLs.
- Creates the onboarding record if it does not exist and sets the status to `pending`.

### Get onboarding status

```http
GET /v1/onboarding/status
Authorization: Bearer <token>
```

- Returns the current onboarding record for the authenticated merchant.
- Automatically creates a `pending` record on first call if none exists.

### Admin review

```http
PATCH /v1/onboarding/:merchantId/review
Authorization: Bearer <admin-token>
Content-Type: application/json
```

Request body:

```json
{
  "status": "approved"
}
```

or

```json
{
  "status": "rejected",
  "rejectionReason": "Incomplete documents"
}
```

- Admin-only endpoint.
- `status` must be one of the `OnboardingStatus` enum values.
- `rejectionReason` is only persisted when `status` is `rejected`. For other statuses it is cleared.
- The merchant receives an email notification when the status changes.

## Review flow

1. Merchant calls `GET /v1/onboarding/status` to obtain or create a pending record.
2. Merchant submits business information via `POST /v1/onboarding/business-info`.
3. Merchant submits documents via `POST /v1/onboarding/documents`.
4. Admin reviews the record and calls `PATCH /v1/onboarding/:merchantId/review` with `approved` or `rejected`.
5. If rejected, the merchant can resubmit corrected information and documents; the admin can review again.
