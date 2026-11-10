# Role-based access control (RBAC)

FacilPay currently has two related access-control mechanisms:

1. **Built-in roles** are stored in `users.roles` and use the `UserRole` enum. They are checked by `RolesGuard` through `@Roles(...)`.
2. **Database roles** are stored in `roles` and referenced by `users.roleId`. A database role contains a list of permission strings and is checked by `PermissionsGuard` through `@Permissions(...)`.

A user can therefore have a built-in role, a database role, both, or neither. The mechanisms are independent: assigning a database role does not change `users.roles`, and changing `users.roles` does not change `users.roleId`.

For merchant-scoped team membership and invitation roles (`ADMIN`, `DEVELOPER`, `SUPPORT`, `VIEWER` under `/v1/team`), see [docs/TEAM.md](TEAM.md).

## Built-in roles

`src/common/constants/roles.ts` defines:

| Value | Source field | Intended access |
| --- | --- | --- |
| `USER` | `users.roles` | Standard user. This value is assigned to newly registered users by default. |
| `ADMIN` | `users.roles` | Platform administrator. Required by the endpoints in the built-in-role table below. |

`RolesGuard` requires at least one value in `@Roles(...)` to occur in `user.roles`. A JWT authenticates the user first, and the guard then reads the role list returned by `JwtStrategy`.

## Permissions

The `roles.permissions` column is a PostgreSQL `text[]`. The following are **all permission strings currently used by `@Permissions(...)` in the source tree**:

| Permission | Meaning | Endpoints |
| --- | --- | --- |
| `manage_roles` | List, read, create, update, and delete database roles. | `GET/POST /v1/auth/admin/roles`, `GET/PATCH/DELETE /v1/auth/admin/roles/:id` |
| `assign_roles` | Assign a database role to a user. | `PATCH /v1/auth/admin/users/:id/role` |

The role DTOs accept arbitrary strings, but an unrecognised string does not grant access to any current `@Permissions(...)` endpoint. `PermissionsGuard` loads the role referenced by `user.roleId` and requires **every** permission named by the decorator to be present in that role. A user without `roleId`, or with a `roleId` that no longer resolves, receives `403`.

## Protected endpoint matrix

Every route below first requires a valid JWT. “Built-in role” routes use `JwtAuthGuard, RolesGuard`; “permission” routes use `JwtAuthGuard, PermissionsGuard`. Routes absent from this table do not have an `@Roles` or `@Permissions` requirement, although they may still require authentication, a signature, an API-key scope, or ownership checks in their service layer.

| Method and path | Built-in role | Permission | Enforcement |
| --- | --- | --- | --- |
| `POST /v1/auth/unlock/:userId` | `ADMIN` | — | `@Roles(UserRole.ADMIN)` in `AuthController` (the decorator is written as `@Roles('ADMIN')`) |
| `GET /v1/users` | `ADMIN` | — | `@Roles(UserRole.ADMIN)` |
| `DELETE /v1/users/:id` | `ADMIN` | — | `@Roles(UserRole.ADMIN)` |
| `POST /v1/users/:id/restore` | `ADMIN` | — | `@Roles(UserRole.ADMIN)` |
| `PATCH /v1/users/:id/rate-limit` | `ADMIN` | — | `@Roles(UserRole.ADMIN)` |
| `PATCH /v1/onboarding/:merchantId/review` | `ADMIN` | — | `@Roles(UserRole.ADMIN)` |
| `GET /v1/admin/audit-logs` | `ADMIN` | — | Controller-level `@Roles(UserRole.ADMIN)` |
| `GET /v1/admin/settlements` | `ADMIN` | — | Controller-level `@Roles(UserRole.ADMIN)` |
| `POST /v1/admin/settlements/run` | `ADMIN` | — | Controller-level `@Roles(UserRole.ADMIN)` |
| `POST /v1/payments/merchant-fee-config/:merchantId` | `ADMIN` | — | `@Roles(UserRole.ADMIN)` |
| `GET /v1/payments/merchant-fee-config/:merchantId/report` | `ADMIN` | — | `@Roles(UserRole.ADMIN)` |
| `PATCH /v1/disputes/:id` | `ADMIN` | — | `@Roles(UserRole.ADMIN)` |
| `GET /v1/auth/admin/roles` | — | `manage_roles` | `@Permissions('manage_roles')` |
| `GET /v1/auth/admin/roles/:id` | — | `manage_roles` | `@Permissions('manage_roles')` |
| `POST /v1/auth/admin/roles` | — | `manage_roles` | `@Permissions('manage_roles')` |
| `PATCH /v1/auth/admin/roles/:id` | — | `manage_roles` | `@Permissions('manage_roles')` |
| `DELETE /v1/auth/admin/roles/:id` | — | `manage_roles` | `@Permissions('manage_roles')` |
| `PATCH /v1/auth/admin/users/:id/role` | — | `assign_roles` | `@Permissions('assign_roles')` |

`ADMIN` in a dynamic role name or a role named `ADMIN` does not by itself satisfy `@Roles(UserRole.ADMIN)`: that guard checks the built-in `users.roles` array. Conversely, having `ADMIN` in `users.roles` does not satisfy a permission route unless `users.roleId` points to a database role containing every required permission.

## Database role management

All examples below use:

```bash
BASE_URL=http://localhost:3000
TOKEN=<JWT for a user whose roleId points to the required database role>
```

### Create a role

```http
POST /v1/auth/admin/roles
Authorization: Bearer <TOKEN>
Content-Type: application/json

{
  "name": "role-manager",
  "permissions": ["manage_roles"],
  "description": "Manages database roles"
}
```

A successful response has status `200` and includes the persisted role:

```json
{
  "id": "8af98248-22e4-45bb-9a37-fda740911111",
  "name": "role-manager",
  "permissions": ["manage_roles"],
  "description": "Manages database roles",
  "createdAt": "2026-09-25T10:00:00.000Z",
  "updatedAt": "2026-09-25T10:00:00.000Z"
}
```

Role names are case-sensitive in the service's duplicate check and are unique in the database.

### List and read roles

```http
GET /v1/auth/admin/roles
Authorization: Bearer <TOKEN>
```

```http
GET /v1/auth/admin/roles/<ROLE_ID>
Authorization: Bearer <TOKEN>
```

The list is ordered by name. Both responses include `id`, `name`, `permissions`, and `description`.

### Update a role

```http
PATCH /v1/auth/admin/roles/<ROLE_ID>
Authorization: Bearer <TOKEN>
Content-Type: application/json

{
  "permissions": ["manage_roles", "assign_roles"],
  "description": "Manages and assigns database roles"
}
```

`name`, `permissions`, and `description` are independently optional. Supplying only `description` leaves the other fields unchanged. Renaming a role to an existing name fails with `400`.

### Delete a role

```http
DELETE /v1/auth/admin/roles/<ROLE_ID>
Authorization: Bearer <TOKEN>
```

A successful response is `204 No Content`. A role referenced by one or more `users.roleId` values cannot be deleted and returns `400`; assign those users to another role first.

### Assign a role to a user

```http
PATCH /v1/auth/admin/users/<USER_ID>/role
Authorization: Bearer <TOKEN>
Content-Type: application/json

{
  "roleId": "8af98248-22e4-45bb-9a37-fda740911111"
}
```

This updates the target user's `roleId` and writes an `auth.role.assigned` audit log. It does **not** change the target's built-in `users.roles` array. The endpoint returns `400` if the user or role does not exist.

The first role administrator still has to be provisioned directly in the database (or by an existing deployment process): the API has no bootstrap endpoint that bypasses `PermissionsGuard`.

## Step-up authentication

`POST /v1/auth/step-up` re-authenticates the current JWT holder and returns a JWT with `purpose: "step-up"` and a five-minute lifetime. The endpoint also writes an `auth.step_up.confirmed` audit log.

Current request validation requires `password`; `totpCode` is optional and, when supplied, must be a valid code for an enabled 2FA account:

```http
POST /v1/auth/step-up
Authorization: Bearer <JWT>
Content-Type: application/json

{
  "password": "P@ssw0rd!"
}
```

Response shape:

```json
{
  "stepUpToken": "<short-lived JWT>",
  "expiresAt": "2026-09-25T10:05:00.000Z",
  "message": "Step-up authentication confirmed. This token is valid for 5 minutes."
}
```

Although comments and the Swagger operation description identify admin-scope API-key operations and high-privilege role assignment as intended step-up-protected operations, **the current source has no guard or service check that reads or validates `stepUpToken`**. Consequently, no existing endpoint actually requires it, including the role and API-key endpoints above. Treat step-up as an implemented token-issuance primitive, not as an enforced authorization boundary, until a consuming guard and DTO/header contract are added.

## Protecting a new endpoint

Authentication, built-in role checks, and permission checks are separate concerns. A merchant-owned route should also compare its resource's `merchantId` with `CurrentUser().id`; RBAC alone does not provide tenant isolation.

### Restrict by built-in role

```ts
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Get('reports')
@GetReports() {
  // ...
}
```

The guard order matters: authenticate the JWT before inspecting the user's roles.

### Restrict by database permission

```ts
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions('manage_roles')
@Post('reports')
CreateReport(@Body() dto: CreateReportDto) {
  // ...
}
```

When an operation needs several permissions, pass them all; `PermissionsGuard` uses `every(...)`, so all are required:

```ts
@Permissions('manage_roles', 'assign_roles')
```

If the new capability deserves a new permission, add it to the `@Permissions(...)` decorator, grant it to the relevant database role through the role API or database provisioning, update the permission inventory in this document, and add a guard test. Do not infer permission access from a role's display name.

### Add tests

At minimum, test both allow and deny paths:

- `RolesGuard`: a user with the required built-in role is allowed; a user without it is denied.
- `PermissionsGuard`: a role containing all required strings is allowed; a missing role, missing `roleId`, or missing permission is denied.
- Service/controller tests: a user cannot access another merchant's resource even when the user passes RBAC.
