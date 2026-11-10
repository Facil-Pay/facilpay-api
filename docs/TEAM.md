# Team Management & Invitations

FacilPay allows merchant account owners to invite teammates to collaborate on their merchant account with scoped team roles (`TeamRole`). Team invitations and memberships are managed under `/v1/team` (`src/modules/team`).

---

## Overview

Each merchant account is owned by a primary `User` (`merchantId = ownerUserId`). Teammates are linked to a merchant account through the `merchant_members` table (`MerchantMember` entity) after accepting a time-limited, SHA-256-hashed invitation token stored in `merchant_invitations` (`MerchantInvitation` entity).

### Invitation Lifecycle

1. **Create Invitation (`POST /v1/team/invitations`)**:
   - The merchant generates an invitation for an email address (`email` is normalised to lowercase) and assigns a `TeamRole`.
   - A 32-byte random hex token (`rawToken`) is generated; only its SHA-256 digest (`tokenHash`) is persisted in `merchant_invitations`.
   - The raw token is returned **once** in the HTTP `201 Created` response (`{ token, invitation }`). FacilPay does not email the raw token directly, so the caller or notification layer must deliver the token to the invitee.
   - If an unexpired pending invitation already exists for the same `(merchantId, email)`, the endpoint returns `409 Conflict`. If a previous pending invitation for that email has expired (`expiresAt <= now`), it is automatically removed and replaced.
2. **Expiry (`72 hours`)**:
   - Invitations expire **72 hours** (`TeamService.INVITATION_TTL_HOURS = 72`) after creation.
   - Attempting to accept an invitation after `expiresAt` returns `400 Bad Request` (`"Invitation has expired"`).
3. **What Happens When the Invitee Has No Account Yet**:
   - Accepting an invitation (`POST /v1/team/invitations/:token/accept`) requires a valid Bearer JWT (`JwtAuthGuard`), and `TeamService.acceptInvitation` verifies that the authenticated user's email matches `invitation.email` (case-insensitive).
   - If the invitee does not have a FacilPay account yet, they must first register (`POST /v1/auth/register`) using the **exact email address** the invitation was sent to, authenticate (`POST /v1/auth/login`) to obtain a JWT, and then call `POST /v1/team/invitations/:token/accept`.
   - Calling `accept` while authenticated as a different email address returns `403 Forbidden` (`"This invitation was sent to a different email address"`).
4. **Accept Invitation (`POST /v1/team/invitations/:token/accept`)**:
   - Marks `invitation.acceptedAt = now` and creates a `MerchantMember` row (`merchantId`, `userId`, `role`, `invitedBy`, `joinedAt`).
   - Subsequent attempts to use the same token fail with `400 Bad Request` (`"Invitation has already been accepted"`).

---

## Team Roles & Permissions (`TeamRole`)

`src/modules/team/entities/merchant-member.entity.ts` defines the `TeamRole` enum assigned to `MerchantMember.role` and `MerchantInvitation.role`:

| Role (`TeamRole` / Owner) | Stored Value | Scope & Capabilities |
| --- | --- | --- |
| **Account Owner** | Implicit (`user.id === merchantId`) | Full control over the merchant account. Cannot have their role modified (`400 Bad Request`) or be removed (`400 Bad Request`) via `/v1/team/members/:id`. |
| `ADMIN` | `'ADMIN'` | Full administrative access to merchant settings, team management, API keys, webhooks, payouts, refunds, and financial operations. |
| `DEVELOPER` | `'DEVELOPER'` | Technical integration access: manage API keys, webhook endpoints, sandbox/simulation tools, and inspect payment/event logs. |
| `SUPPORT` | `'SUPPORT'` | Operational customer support access: view payments, customers, invoices, disputes, and initiate refunds without changing developer or team configuration. |
| `VIEWER` | `'VIEWER'` | Read-only access to merchant transactions, analytics, invoices, and settlement reports. |

> **Note on RBAC vs. Team Roles:** Built-in platform roles (`UserRole.USER`, `UserRole.ADMIN` in `users.roles`) and database permission roles (`users.roleId`) are documented in [docs/RBAC.md](RBAC.md). `TeamService.resolveEffectiveMerchantId(userId, requestedMerchantId)` verifies whether a user is either the merchant owner (`requestedMerchantId === userId`) or an active member in `merchant_members`.

---

## Endpoints

All `/v1/team` endpoints require a valid Bearer JWT (`Authorization: Bearer <JWT>`).

### 1. Invite a Team Member

```http
POST /v1/team/invitations
Authorization: Bearer <JWT>
Content-Type: application/json

{
  "email": "teammate@example.com",
  "role": "DEVELOPER"
}
```

#### Request Body (`InviteMemberDto`)

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `email` | `string` (email) | Yes | Email address of the invitee (normalised to lowercase). |
| `role` | `TeamRole` (`ADMIN` \| `DEVELOPER` \| `SUPPORT` \| `VIEWER`) | Yes | Role to assign once the invitation is accepted. |

#### Response (`201 Created`)

```json
{
  "token": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  "invitation": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "merchantId": "11111111-2222-3333-4444-555555555555",
    "email": "teammate@example.com",
    "role": "DEVELOPER",
    "invitedBy": "11111111-2222-3333-4444-555555555555",
    "expiresAt": "2026-10-02T10:00:00.000Z",
    "acceptedAt": null,
    "createdAt": "2026-09-29T10:00:00.000Z"
  }
}
```

#### Error Responses

- `400 Bad Request`: Invalid email or unsupported `role`.
- `401 Unauthorized`: Missing or invalid JWT.
- `409 Conflict`: An unexpired invitation already exists for this email under the merchant account.

---

### 2. Accept an Invitation

```http
POST /v1/team/invitations/:token/accept
Authorization: Bearer <INVITEE_JWT>
```

#### Path Parameters

| Parameter | Type | Description |
| --- | --- | --- |
| `token` | `string` | Raw 64-character hex token returned when the invitation was created. |

#### Response (`200 OK`)

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "merchantId": "11111111-2222-3333-4444-555555555555",
  "userId": "99999999-8888-7777-6666-555555555555",
  "role": "DEVELOPER",
  "invitedBy": "11111111-2222-3333-4444-555555555555",
  "joinedAt": "2026-09-29T12:00:00.000Z",
  "createdAt": "2026-09-29T12:00:00.000Z",
  "updatedAt": "2026-09-29T12:00:00.000Z"
}
```

#### Error Responses

- `400 Bad Request`: Invitation has already been accepted or has expired (`expiresAt < now`).
- `403 Forbidden`: Authenticated user's email does not match `invitation.email`.
- `404 Not Found`: Token hash does not match any invitation.
- `409 Conflict`: User is already a member of the merchant account.

---

### 3. List Team Members

```http
GET /v1/team/members
Authorization: Bearer <JWT>
```

#### Response (`200 OK`)

Returns all `MerchantMember` records for the authenticated merchant ordered by `joinedAt ASC`:

```json
[
  {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "merchantId": "11111111-2222-3333-4444-555555555555",
    "userId": "99999999-8888-7777-6666-555555555555",
    "role": "DEVELOPER",
    "invitedBy": "11111111-2222-3333-4444-555555555555",
    "joinedAt": "2026-09-29T12:00:00.000Z",
    "createdAt": "2026-09-29T12:00:00.000Z",
    "updatedAt": "2026-09-29T12:00:00.000Z"
  }
]
```

---

### 4. Update a Team Member's Role

```http
PATCH /v1/team/members/:id
Authorization: Bearer <JWT>
Content-Type: application/json

{
  "role": "SUPPORT"
}
```

#### Request Body (`UpdateMemberRoleDto`)

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `role` | `TeamRole` (`ADMIN` \| `DEVELOPER` \| `SUPPORT` \| `VIEWER`) | Yes | New role for the member. |

#### Error Responses

- `400 Bad Request`: Attempted to change the role of the merchant owner (`member.userId === merchantId`) or supplied an invalid `role`.
- `403 Forbidden`: Member belongs to a different merchant (`member.merchantId !== merchantId`).
- `404 Not Found`: Member UUID does not exist.

---

### 5. Remove a Team Member

```http
DELETE /v1/team/members/:id
Authorization: Bearer <JWT>
```

#### Response (`204 No Content`)

Removes the `MerchantMember` record and writes a `team.member.removed` audit log entry.

#### Error Responses

- `400 Bad Request`: Attempted to remove the merchant owner (`member.userId === merchantId`).
- `403 Forbidden`: Member belongs to a different merchant.
- `404 Not Found`: Member UUID does not exist.

---

## Audit Log Events

All team mutations emit structured audit log records via `AuditLogsService.record`:

| Action | Resource Type | Trigger | Metadata |
| --- | --- | --- | --- |
| `team.invitation.created` | `merchant_invitation` | `POST /v1/team/invitations` | `{ email, role, merchantId }` |
| `team.invitation.accepted` | `merchant_member` | `POST /v1/team/invitations/:token/accept` | `{ merchantId, role, invitationId }` |
| `team.member.role_updated` | `merchant_member` | `PATCH /v1/team/members/:id` | `{ from, to, merchantId }` |
| `team.member.removed` | `merchant_member` | `DELETE /v1/team/members/:id` | `{ merchantId, removedUserId }` |
