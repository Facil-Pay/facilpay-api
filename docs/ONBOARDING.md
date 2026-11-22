# Onboarding

The onboarding module manages the merchant onboarding workflow, including account creation, verification, compliance checks, and initial setup.

## Overview

The onboarding system guides new merchants through account creation and verification steps, collecting required information, validating compliance, and provisioning accounts for payment processing.

## Key Concepts

### Onboarding Status

Each merchant account progresses through the following states:
- `pending` - Initial state, awaiting submission of required information
- `verifying` - Under review by compliance team
- `active` - Approved and ready for payment processing
- `rejected` - Did not pass compliance verification
- `suspended` - Previously active account has been suspended

### KYC/AML Requirements

Merchants must complete Know Your Customer (KYC) and Anti-Money Laundering (AML) verification:
- Business information collection
- Owner/beneficial owner identification
- Address and contact verification
- Tax identification documentation
- Banking details verification

### Business Classification

Merchants are categorized by business type for appropriate compliance rules:
- Sole proprietorship
- Partnership
- Limited Liability Company (LLC)
- Corporation
- Non-profit organization
- Government entity
- Other regulated entity

## API Endpoints

### Create Merchant Account
```
POST /onboarding/merchants
```

Initiates a new merchant onboarding application.

**Request body:**
```json
{
  "businessName": "string",
  "businessType": "sole_proprietor | partnership | llc | corporation | nonprofit",
  "email": "string",
  "phone": "string",
  "countryCode": "string (ISO 3166-1 alpha-2)"
}
```

**Response:**
```json
{
  "id": "string (UUID)",
  "status": "pending",
  "createdAt": "ISO 8601 timestamp"
}
```

### Submit Onboarding Information
```
PATCH /onboarding/merchants/{merchantId}
```

Submits required KYC/AML information for verification.

**Request body:**
```json
{
  "ownerName": "string",
  "ownerEmail": "string",
  "businessRegistration": "string (document URL or ID)",
  "taxId": "string",
  "bankingDetails": {
    "accountName": "string",
    "accountNumber": "string",
    "routingNumber": "string",
    "bankName": "string"
  }
}
```

**Response:**
```json
{
  "id": "string (UUID)",
  "status": "verifying",
  "submittedAt": "ISO 8601 timestamp"
}
```

### Get Onboarding Status
```
GET /onboarding/merchants/{merchantId}
```

Retrieves the current onboarding status and any compliance findings.

**Response:**
```json
{
  "id": "string (UUID)",
  "businessName": "string",
  "status": "pending | verifying | active | rejected | suspended",
  "complianceNotes": "string (if rejected or flagged)",
  "createdAt": "ISO 8601 timestamp",
  "verifiedAt": "ISO 8601 timestamp (if active)"
}
```

### List Onboarding Applications
```
GET /onboarding/merchants
```

Lists onboarding applications with optional filtering by status.

**Query parameters:**
- `status` - Filter by onboarding status
- `page` - Pagination page number
- `limit` - Results per page (default: 25, max: 100)

**Response:**
```json
{
  "data": [
    {
      "id": "string (UUID)",
      "businessName": "string",
      "status": "string",
      "createdAt": "ISO 8601 timestamp"
    }
  ],
  "pagination": {
    "page": "number",
    "limit": "number",
    "total": "number"
  }
}
```

## Service Architecture

### OnboardingService

The core service handling onboarding workflows:

**Key methods:**
- `createMerchantAccount(data)` - Initiates new onboarding application
- `submitOnboardingInfo(merchantId, data)` - Submits KYC/AML information
- `getMerchantStatus(merchantId)` - Retrieves current status
- `listApplications(filters)` - Lists all applications with filtering
- `approveMerchant(merchantId)` - Marks merchant as active (admin)
- `rejectMerchant(merchantId, reason)` - Rejects application with reason (admin)

### Database Schema

**merchants_onboarding table:**
- `id` (UUID) - Primary key
- `merchant_id` (UUID) - Foreign key to merchants
- `business_name` (VARCHAR) - Registered business name
- `business_type` (VARCHAR) - Classification of business
- `owner_name` (VARCHAR) - Primary owner name
- `owner_email` (VARCHAR) - Owner email address
- `tax_id` (VARCHAR) - Tax identification number
- `status` (VARCHAR) - Current onboarding status
- `submission_data` (JSONB) - Full submission payload
- `compliance_notes` (TEXT) - Notes from compliance review
- `created_at` (TIMESTAMP) - Application creation time
- `verified_at` (TIMESTAMP) - Approval/rejection time
- `verified_by` (UUID) - Admin user who made decision
- `updated_at` (TIMESTAMP) - Last update timestamp

## Compliance Workflow

1. **Application Submission** - Merchant provides KYC/AML information
2. **Automated Checks** - System validates data completeness and format
3. **Risk Assessment** - PEP lists, sanctions checks, and fraud scoring
4. **Manual Review** - Compliance team reviews flagged applications
5. **Decision** - Approve for active status or reject with reasons
6. **Notification** - Merchant notified of decision

## Error Handling

### Common Errors

**400 Bad Request** - Invalid input data
```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "errors": ["businessName is required", "businessType must be valid"]
}
```

**409 Conflict** - Merchant already onboarded
```json
{
  "statusCode": 409,
  "message": "Merchant already has an active account"
}
```

**422 Unprocessable Entity** - Business logic violation
```json
{
  "statusCode": 422,
  "message": "Cannot submit onboarding info: application already under review"
}
```

**404 Not Found** - Merchant or application not found
```json
{
  "statusCode": 404,
  "message": "Onboarding application not found"
}
```

## Security Considerations

- All onboarding data is encrypted at rest
- Personally identifiable information (PII) is masked in logs
- Compliance notes are only visible to authorized admin users
- Audit logging records all onboarding decisions and changes
- Rate limiting applies to prevent enumeration attacks
- HTTPS required for all onboarding endpoints

## Testing

Unit tests are available in `src/modules/onboarding/onboarding.service.spec.ts` covering:
- Merchant account creation
- KYC/AML information submission and validation
- Status transitions and state management
- Error handling for edge cases
- Role-based authorization
- Idempotency and concurrent requests

## See Also

- [RBAC.md](./RBAC.md) - Role-based access control
- [NOTIFICATIONS.md](./NOTIFICATIONS.md) - Notification delivery
- [ENVIRONMENT.md](./ENVIRONMENT.md) - Configuration reference
