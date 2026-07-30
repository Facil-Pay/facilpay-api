# Task: Add API Key Rotation & Payment Timeline Endpoints

## Steps

- [x] Step 1: Add `POST /api-keys/:id/rotate` endpoint in `api-keys.controller.ts`
- [x] Step 2: Create `payment-timeline.dto.ts` for timeline event types
- [x] Step 3: Add `getTimeline()` method in `payments.service.ts`
- [x] Step 4: Add `GET /payments/:id/timeline` endpoint in `payments.controller.ts`

## Summary

### 1. POST /v1/api-keys/:id/rotate
- **File**: `src/modules/api-keys/api-keys.controller.ts`
- **Description**: Revokes the current API key and creates a new one with the same name, scope, and environment settings. Returns `{ apiKey, plaintext }`.
- **Auth**: Requires JWT bearer token (uses `@CurrentUser()` decorator)
- **Service method**: `ApiKeysService.rotate(id, userId)` — already existed, now wired to the endpoint

### 2. GET /v1/payments/:id/timeline
- **Files**: 
  - `src/modules/payments/dto/payment-timeline.dto.ts` (new)
  - `src/modules/payments/payments.service.ts` (new `getTimeline()` method)
  - `src/modules/payments/payments.controller.ts` (new `@Get(':id/timeline')` endpoint)
- **Description**: Returns a chronological array of events for a payment, including:
  - `payment.created` — payment creation
  - `payment.status_updated` — status transitions
  - `payment.cancelled` — cancellation
  - `payment.expired` — expiry
  - `refund.created` — each refund issued
  - `dispute.opened` / `dispute.resolved` / `dispute.closed` — dispute lifecycle
- **Auth**: Requires JWT bearer token

