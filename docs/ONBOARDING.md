# Merchant Onboarding

The onboarding module lets merchants submit business information and documents, check their application status, and lets FacilPay admins approve or reject applications.

## Endpoints

All endpoints require a valid bearer token (`JwtAuthGuard`). The admin review endpoint additionally requires the `ADMIN` role.

### `POST /v1/onboarding/business-info`

Submits or updates a merchant's business information.

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `businessName` | string | yes | Legal or trading name of the business. |
| `businessEmail` | string (email) | yes | Contact email for onboarding notifications. |
| `businessAddress` | string | no | Physical or registered business address. |

**Behavior**

- Creates a new onboarding record if one does not already exist for the authenticated merchant.
- Overwrites `businessName` and `businessEmail`. `businessAddress` is merged with any existing value when omitted.
- Sets the record status to `OnboardingStatus.PENDING`.

### `POST /v1/onboarding/documents`

Submits or updates identity and business verification documents.

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `idDocumentUrl` | string (URL) | yes | URL of a government-issued ID document. |
| `businessCertificateUrl` | string (URL) | yes | URL of a business registration or certificate document. |

**Behavior**

- Creates a new onboarding record if one does not already exist for the authenticated merchant.
- Overwrites the document URLs and sets the status to `OnboardingStatus.PENDING`.

### `GET /v1/onboarding/status`

Returns the current onboarding record for the authenticated merchant.

**Behavior**

- If no record exists, a new record is created automatically with status `PENDING` and then returned.
- Use this endpoint to poll the result of a submitted review.

### `PATCH /v1/onboarding/:merchantId/review`

Admin-only endpoint to approve or reject a merchant's onboarding application.

**Path parameter**

| Field | Type | Description |
|---|---|---|
| `merchantId` | string | UUID of the merchant whose record is being reviewed. |

**Request body**

| Field | Type | Required | Description |
|---|---|---|---|
| `status` | enum (`pending`, `under_review`, `approved`, `rejected`) | yes | New onboarding status. |
| `rejectionReason` | string | no | Required only when `status` is `rejected`. Ignored for other statuses. |

**Behavior**

- Rejects the request with `404 Not Found` if no onboarding record exists for the merchant.
- When `status` is `rejected`, `rejectionReason` is persisted. For any other status the field is set to `null`.
- Sends a status-update email to the merchant's `businessEmail` if one is present.

## Onboarding statuses

| Status | Meaning |
|---|---|
| `pending` | Record created; business info and/or documents may still be missing. |
| `under_review` | Submitted and awaiting admin review. |
| `approved` | Onboarding complete; the merchant can use full platform features. |
| `rejected` | Application rejected. `rejectionReason` contains the cause. |

## Typical flow

1. Merchant calls `POST /v1/onboarding/business-info` with business details.
2. Merchant calls `POST /v1/onboarding/documents` with verification document URLs.
3. Merchant polls `GET /v1/onboarding/status` to wait for a decision.
4. An admin reviews the record and calls `PATCH /v1/onboarding/:merchantId/review` with `approved` or `rejected`.
