# Merchant Branding

## Overview

Merchant branding allows merchants to customize the appearance of customer-facing emails, receipts, and invoice PDFs with their own branding. This includes custom display names, logos, colors, and support contact information.

When branding is not configured, the system falls back to FacilPay defaults.

---

## Branding Object

```json
{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "merchantId": "abc123-merchant-uuid",
  "displayName": "Acme Corporation",
  "logo": "https://s3.example.com/logos/acme.png",
  "primaryColor": "#1a73e8",
  "supportEmail": "support@acme.com",
  "supportUrl": "https://acme.com/support",
  "createdAt": "2026-01-15T10:30:00.000Z",
  "updatedAt": "2026-01-15T10:30:00.000Z"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Branding record identifier |
| `merchantId` | UUID | Owner merchant identifier |
| `displayName` | String | Merchant display name (max 100 characters) |
| `logo` | String | URL to logo (PNG/SVG, max 500 KB) |
| `primaryColor` | String | Hex color code (e.g., `#1a73e8`) |
| `supportEmail` | String | Support contact email (optional) |
| `supportUrl` | String | Support contact URL (optional) |
| `createdAt` | Date | Branding creation timestamp |
| `updatedAt` | Date | Last update timestamp |

---

## API Endpoints

### GET /v1/merchants/me/branding

Retrieve the current merchant's branding settings.

**Authentication**: JWT Bearer token required

**Request**:
```http
GET /v1/merchants/me/branding HTTP/1.1
Host: api.facilpay.com
Authorization: Bearer <jwt_token>
```

**Response** (200 OK):
```json
{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "merchantId": "abc123-merchant-uuid",
  "displayName": "Acme Corporation",
  "logo": "https://s3.example.com/logos/acme.png",
  "primaryColor": "#1a73e8",
  "supportEmail": "support@acme.com",
  "supportUrl": "https://acme.com/support",
  "createdAt": "2026-01-15T10:30:00.000Z",
  "updatedAt": "2026-01-15T10:30:00.000Z"
}
```

**Fallback Response** (200 OK - when no branding configured):
```json
{
  "displayName": "FacilPay",
  "logo": null,
  "primaryColor": "#1a1a2e",
  "supportEmail": null,
  "supportUrl": null
}
```

---

### PATCH /v1/merchants/me/branding

Update the merchant's branding settings.

**Authentication**: JWT Bearer token required

**Request**:
```http
PATCH /v1/merchants/me/branding HTTP/1.1
Host: api.facilpay.com
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "displayName": "Acme Corporation",
  "primaryColor": "#1a73e8",
  "supportEmail": "support@acme.com",
  "supportUrl": "https://acme.com/support"
}
```

**Validation Rules**:
- `displayName`: Max 100 characters
- `primaryColor`: Valid hex color code format (e.g., `#RRGGBB`)
- `supportEmail`: Valid email format
- `supportUrl`: Valid HTTPS URL format

**Response** (200 OK):
```json
{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "merchantId": "abc123-merchant-uuid",
  "displayName": "Acme Corporation",
  "logo": "https://s3.example.com/logos/acme.png",
  "primaryColor": "#1a73e8",
  "supportEmail": "support@acme.com",
  "supportUrl": "https://acme.com/support",
  "createdAt": "2026-01-15T10:30:00.000Z",
  "updatedAt": "2026-01-15T12:45:00.000Z"
}
```

**Error Responses**:
- `400 Bad Request`: Invalid color format or email
- `401 Unauthorized`: Missing or invalid authentication token
- `413 Payload Too Large`: displayName exceeds 100 characters

---

### PUT /v1/merchants/me/branding/logo

Upload or update the merchant's logo.

**Authentication**: JWT Bearer token required

**Request**:
```http
PUT /v1/merchants/me/branding/logo HTTP/1.1
Host: api.facilpay.com
Authorization: Bearer <jwt_token>
Content-Type: multipart/form-data

[Binary PNG or SVG file, max 500 KB]
```

**File Requirements**:
- Format: PNG or SVG
- Max size: 500 KB
- Files are stored securely with CDN distribution

**Response** (200 OK):
```json
{
  "logoUrl": "https://s3.example.com/logos/acme-abc123.png"
}
```

**Error Responses**:
- `400 Bad Request`: Invalid file format or size exceeds 500 KB
- `401 Unauthorized`: Missing or invalid authentication token
- `413 Payload Too Large`: File exceeds 500 KB limit

---

## Integration Points

### Email Templates

Branding settings are passed to Handlebars email templates with the following variables:

```handlebars
{{branding.displayName}}       {{!-- Merchant display name --}}
{{branding.logo}}              {{!-- Logo URL --}}
{{branding.primaryColor}}      {{!-- Primary hex color --}}
{{branding.supportEmail}}      {{!-- Support email --}}
{{branding.supportUrl}}        {{!-- Support URL --}}
```

### Invoice PDFs

Invoice generation includes branding in the header section:
- Logo positioned top-left of invoice
- Display name below logo
- Primary color used for accent elements (borders, headings)
- Support contact info displayed in footer

### Receipts

Receipt emails use the same branding variables as transactional emails, with logo and color applied consistently.

### Customer Portal

If available, the customer portal displays merchant branding:
- Logo in header
- Display name in page title and headers
- Primary color for UI accents and buttons

---

## Defaults (Fallback)

When a merchant has not configured branding, the system uses FacilPay defaults:

| Field | Default |
|-------|---------|
| `displayName` | "FacilPay" |
| `logo` | None |
| `primaryColor` | "#1a1a2e" |
| `supportEmail` | None |
| `supportUrl` | None |

These defaults are applied automatically when branding is not configured or when specific fields are null.

---

## Examples

### Example 1: Setting Up Merchant Branding

1. **Update branding settings**:
```bash
curl -X PATCH https://api.facilpay.com/v1/merchants/me/branding \
  -H "Authorization: Bearer <jwt_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "displayName": "My Shop",
    "primaryColor": "#ff6b6b",
    "supportEmail": "help@myshop.com",
    "supportUrl": "https://myshop.com/help"
  }'
```

2. **Upload logo**:
```bash
curl -X PUT https://api.facilpay.com/v1/merchants/me/branding/logo \
  -H "Authorization: Bearer <jwt_token>" \
  -F "file=@logo.png"
```

3. **Retrieve branding settings**:
```bash
curl https://api.facilpay.com/v1/merchants/me/branding \
  -H "Authorization: Bearer <jwt_token>"
```

---

### Example 2: Valid Hex Colors

```json
{
  "primaryColor": "#1a73e8"    // Blue
}
```

```json
{
  "primaryColor": "#ff6b6b"    // Red
}
```

```json
{
  "primaryColor": "#2ecc71"    // Green
}
```

---

### Example 3: Logo Upload with cURL

```bash
# Upload a PNG logo
curl -X PUT https://api.facilpay.com/v1/merchants/me/branding/logo \
  -H "Authorization: Bearer <jwt_token>" \
  -F "file=@/path/to/logo.png"

# Upload an SVG logo
curl -X PUT https://api.facilpay.com/v1/merchants/me/branding/logo \
  -H "Authorization: Bearer <jwt_token>" \
  -F "file=@/path/to/logo.svg"
```

---

### Example 4: Update Multiple Fields

```bash
curl -X PATCH https://api.facilpay.com/v1/merchants/me/branding \
  -H "Authorization: Bearer <jwt_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "displayName": "Acme Corp",
    "primaryColor": "#2c3e50",
    "supportEmail": "support@acme.com",
    "supportUrl": "https://acme.com/contact"
  }'
```

---

## Best Practices

### Logo Design

- Use square logos for best appearance in email headers
- Ensure logo looks good at 200x200px (typical email header size)
- Use PNG for photos/complex images
- Use SVG for logos and icons
- Keep file size under 100KB for optimal loading

### Color Selection

- Choose colors that complement your brand
- Ensure sufficient contrast for accessibility
- Test colors in different contexts (email, PDF, web)
- Primary color is used for accents, not large blocks

### Support Information

- Provide both email and URL for support channels
- Ensure URLs are HTTPS
- Keep support contact info current
- Test that links work in emails and PDFs

### Branding Updates

- Update branding settings after rebranding initiatives
- Test changes in sandbox before deploying
- Allow time for email cache invalidation
- Communicate branding changes to customers if applicable

---

## Rate Limiting

Branding endpoints follow standard merchant rate limits:
- PATCH requests: 10 per minute
- PUT logo uploads: 5 per minute
- GET requests: 30 per minute

---

## Security Notes

- Logos are scanned for malware before storage
- All URLs are validated as secure HTTPS URLs
- Branding data is cached for 1 hour to reduce database queries
- Logo URLs are served through a CDN with automatic compression
- Stored logos are backed up regularly

---

## Storage

- Logos are stored in secure cloud storage
- CDN distribution ensures fast loading worldwide
- Automatic image optimization for various formats
- Logos retained indefinitely unless explicitly deleted

---

## Customization Limits

FacilPay supports customization within these limits:

| Item | Limit |
|------|-------|
| Display Name | 100 characters |
| Logo File Size | 500 KB |
| Logo Formats | PNG, SVG |
| Hex Color | Valid 6-digit format |
| Support Email | Standard email format |
| Support URL | Valid HTTPS URL |

---

## Troubleshooting

### Logo Not Appearing in Emails

- Verify logo upload was successful (check response URL)
- Ensure logo file format is PNG or SVG
- Check that logo file is under 500 KB
- Clear email client cache
- Wait 1 hour for CDN cache to expire

### Color Not Applying in PDFs

- Verify hex color format is correct (#RRGGBB)
- Ensure sufficient contrast with white text
- Check PDF reader for color display settings

### Support URLs Not Working

- Verify URL starts with https://
- Test URL in browser before updating
- Check for typos in domain name
