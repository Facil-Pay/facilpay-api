# Merchant Branding

## Overview

Merchant branding allows merchants to customize the appearance of customer-facing communications including emails, receipts, and invoice PDFs with their own branding elements such as logo, display name, primary color, and support contact information.

## Problem Statement

Without branding customization, all customer-facing communications use FacilPay branding, which can create confusion about who initiated the payment request. This reduces customer trust and increases support friction.

## Features

- Customize merchant display name, logo, primary color
- Set support contact information (email and URL)
- Apply branding to all customer-facing communications (emails, PDFs, invoices)
- Fallback to FacilPay defaults when branding is not configured

## Data Model

The `MerchantBranding` entity stores branding configuration for each merchant:

```typescript
@Entity('merchant_branding')
export class MerchantBranding {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  merchantId: string;  // FK to users table

  @Column({ length: 100 })
  displayName: string;  // Merchant display name for customer communications

  @Column({ nullable: true, type: 'text' })
  logo: string | null;  // URL to logo (PNG/SVG)

  @Column({ default: '#1a1a2e' })
  primaryColor: string;  // Hex color code for branding

  @Column({ nullable: true })
  supportEmail: string | null;  // Support email for payers

  @Column({ nullable: true })
  supportUrl: string | null;  // Support URL for payers

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
```

## API Endpoints

### `GET /v1/merchants/me/branding`

Retrieves the authenticated merchant's branding configuration.

**Authentication**: JWT Bearer token required

**Response** (200 OK):

```json
{
  "id": "uuid",
  "merchantId": "uuid",
  "displayName": "Acme Corp",
  "logo": "https://cdn.example.com/logo.png",
  "primaryColor": "#0066cc",
  "supportEmail": "support@acme.com",
  "supportUrl": "https://acme.com/support",
  "createdAt": "2026-01-15T10:00:00Z",
  "updatedAt": "2026-01-15T10:00:00Z"
}
```

If no branding is configured, returns FacilPay defaults:

```json
{
  "displayName": "FacilPay",
  "logo": null,
  "primaryColor": "#1a1a2e",
  "supportEmail": null,
  "supportUrl": null
}
```

### `PATCH /v1/merchants/me/branding`

Updates the authenticated merchant's branding configuration. All fields are optional.

**Authentication**: JWT Bearer token required

**Request Body**:

```json
{
  "displayName": "Acme Corporation",
  "primaryColor": "#0066cc",
  "supportEmail": "help@acme.com",
  "supportUrl": "https://acme.com/support"
}
```

**Validation Rules**:

- `displayName`: 1-100 characters
- `primaryColor`: Valid hex color format (#RRGGBB)
- `supportEmail`: Valid email format
- `supportUrl`: Valid HTTPS URL format

**Response** (200 OK): Updated `MerchantBranding` object

### `PUT /v1/merchants/me/branding/logo`

Uploads a logo image for the merchant's branding. The file is stored and a URL is returned.

**Authentication**: JWT Bearer token required

**Content-Type**: `multipart/form-data`

**Request**:

```
PUT /v1/merchants/me/branding/logo
Content-Type: multipart/form-data

file: <binary PNG or SVG file>
```

**Validation**:

- Accepted formats: PNG, SVG
- Maximum file size: 500 KB
- SVGs are validated for safe content (no scripts)

**Response** (200 OK):

```json
{
  "logoUrl": "https://cdn.facilpay.com/merchants/uuid/logo.png"
}
```

**Error Responses**:

- `400 Bad Request`: Invalid file format or size exceeds limit
- `413 Payload Too Large`: File exceeds 500 KB
- `422 Unprocessable Entity`: SVG contains unsafe content

## Integration Points

### Email Templates

Branding data is passed to Handlebars email templates:

```handlebars
<div style="background-color: {{primaryColor}};">
  {{#if logo}}
    <img src="{{logo}}" alt="{{displayName}}" />
  {{else}}
    <h1>{{displayName}}</h1>
  {{/if}}
</div>
<p>Sent by {{displayName}}</p>
{{#if supportEmail}}
  <a href="mailto:{{supportEmail}}">Support</a>
{{/if}}
```

### Invoice PDF Generation

The invoice generator receives branding configuration:

```typescript
const invoice = await this.invoiceService.generate(payment, {
  branding: {
    displayName: branding.displayName,
    logo: branding.logo,
    primaryColor: branding.primaryColor,
  },
});
```

## Error Handling

| Error Code | Scenario                          | Message                              |
| ---------- | --------------------------------- | ------------------------------------ |
| 400        | Invalid hex color format          | "Invalid primaryColor format"        |
| 400        | Invalid email format              | "Invalid supportEmail format"        |
| 400        | Invalid URL format                | "Invalid supportUrl format"          |
| 413        | Logo file exceeds 500 KB          | "Logo file size exceeds 500 KB"      |
| 422        | SVG contains unsafe content       | "Logo contains unsafe content"       |
| 404        | Merchant not found                | "Merchant not found"                 |

## Usage Example

```bash
# Get current branding
curl -X GET https://api.facilpay.com/v1/merchants/me/branding \
  -H "Authorization: Bearer {token}"

# Update branding details
curl -X PATCH https://api.facilpay.com/v1/merchants/me/branding \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "displayName": "Acme Corp",
    "primaryColor": "#0066cc",
    "supportEmail": "support@acme.com"
  }'

# Upload logo
curl -X PUT https://api.facilpay.com/v1/merchants/me/branding/logo \
  -H "Authorization: Bearer {token}" \
  -F "file=@logo.png"
```

## Fallback Behavior

All customer-facing communications fall back to FacilPay defaults when branding is not configured:

- **Display Name**: "FacilPay"
- **Logo**: FacilPay logo
- **Primary Color**: "#1a1a2e" (FacilPay brand blue)
- **Support Email/URL**: FacilPay support defaults

This ensures seamless operation whether a merchant has configured branding or not.

## Security Considerations

- Logo uploads are validated for MIME type, file size, and (for SVGs) unsafe content
- Merchant can only access/modify their own branding
- URLs are validated to be HTTPS and not point to private/local IP ranges
- Logo files are scanned for malicious content before storage
