# Sessions

The sessions module (`src/modules/sessions`) exposes endpoints to list a user's
active sessions and to revoke them. This document describes what a session
represents, the fields that are recorded for each session, how sessions relate
to refresh tokens, and the exact semantics of revocation.

## What is a session?

A session represents a single authenticated login. When a user authenticates,
FacilPay creates a `Session` row together with a refresh token. The session is
the durable record of "this device logged in here, at this time", while the
refresh token is the credential that keeps that session alive.

Sessions are stored in the `sessions` table (`src/modules/auth/entities/session.entity.ts`).

### Session fields

| Field | Type | Description |
| --- | --- | --- |
| `id` | `uuid` | Primary key. This is the value used in `DELETE /v1/sessions/:id`. |
| `userId` | `string` (indexed) | The owning user. |
| `deviceInfo` | `string \| null` | Client-reported device metadata. Currently always `null` on creation. |
| `ipAddress` | `string \| null` | IP address the session was last active from. |
| `userAgent` | `string \| null` (max 512) | The `User-Agent` header the session was last active with. |
| `lastActiveAt` | `timestamp with time zone` | When the session was last touched. |
| `expiresAt` | `timestamp with time zone` | When the session expires. |
| `revoked` | `boolean` (default `false`) | Whether the session has been revoked. |
| `createdAt` | `timestamp with time zone` | Creation timestamp. |

Session lifetime is fixed at **30 days** (`SESSION_DURATION_DAYS = 30` in
`sessions.service.ts`). Each time a session is touched (see below) both
`lastActiveAt` and `expiresAt` are extended by another 30 days, so an actively
used session does not expire.

## Endpoints

Both endpoints require authentication (JWT) and are scoped to the current user.

### `GET /v1/sessions` — List active sessions

Returns the authenticated user's active sessions. A session is considered
active when `revoked = false` **and** `expiresAt` is in the future. Results are
ordered by `lastActiveAt` descending (most recently active first).

Response (array of `SessionResponseDto`):

```json
[
  {
    "id": "3f2b1c4a-...",
    "deviceInfo": null,
    "ipAddress": "203.0.113.7",
    "userAgent": "Mozilla/5.0 ...",
    "lastActiveAt": "2026-09-27T12:00:00.000Z",
    "expiresAt": "2026-10-27T12:00:00.000Z",
    "createdAt": "2026-09-27T12:00:00.000Z"
  }
]
```

Errors:

| Status | Condition |
| --- | --- |
| `401 Unauthorized` | Missing or invalid JWT. |

### `DELETE /v1/sessions/:id` — Revoke a session

Revokes the session identified by `:id` **and** its associated refresh token.
It does not affect the user's other sessions.

On success the endpoint returns `204 No Content`.

Errors:

| Status | Condition |
| --- | --- |
| `401 Unauthorized` | Missing or invalid JWT. |
| `403 Forbidden` | The session belongs to another user. |
| `404 Not Found` | No session exists with that id. |

## Relationship between sessions and refresh tokens

- Each session is linked to its refresh token(s) via the refresh token's
  `sessionId` column.
- `DELETE /v1/sessions/:id` revokes the session (`revoked = true`) and then
  revokes every refresh token whose `sessionId` matches
  (`update({ sessionId }, { revoked: true })`).
- A standalone logout (`POST /v1/auth/logout`) revokes only the single refresh
  token that was submitted; it does not mark the session row revoked directly.

## Revocation semantics

Revocation takes effect **immediately for refresh tokens, but not for already
issued access tokens**.

- The **access token** is a short-lived JWT. Revoking a session does not
  invalidate an access token that has already been issued; it remains valid
  until its natural expiry.
- The **refresh token** for the revoked session is marked `revoked = true`
  immediately, so the next attempt to refresh fails and the client cannot
  obtain a new access token.

The practical effect: after revoking a session, the affected device keeps
working only until its current access token expires (typically minutes), then
is locked out.

## Wider revocation paths

The following operations revoke refresh tokens beyond the single-session
endpoint:

- **Refresh-token reuse detection** — if a refresh token that has already been
  used (or is revoked) is presented again, the service revokes **all** of the
  user's refresh tokens as a safety measure and returns `401`.
- **Password reset** — completing a password reset revokes **all** refresh
  tokens for the user, signing out every session.

## Related files

- `src/modules/sessions/sessions.controller.ts`
- `src/modules/sessions/sessions.service.ts`
- `src/modules/sessions/dto/session.dto.ts`
- `src/modules/auth/entities/session.entity.ts`
- `src/modules/auth/auth.service.ts` (logout, refresh, password reset)
