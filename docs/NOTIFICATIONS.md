# Notifications

FacilPay delivers two layers of merchant notifications: an **in-app notification centre** surfaced through the API, and **transactional emails** sent to the merchant's registered address. Each merchant can opt in or out of email per category through notification preferences.

All endpoints require a valid JWT in the `Authorization: Bearer <jwt>` header.

---

## In-App Notification Centre

### Notification Types

Every in-app notification has a `type` field drawn from this set:

| Type                        | Title example                 | Triggered when                                                                 |
| --------------------------- | ----------------------------- | ------------------------------------------------------------------------------ |
| `payment_received`          | Payment Received: 100.00 USD  | A merchant payment is completed (`sendMerchantPaymentReceived`).               |
| `refund_issued`             | Refund Issued: 50.00 USD      | A refund is committed for a merchant payment (`sendMerchantRefundIssued`).     |
| `dispute_opened`            | Dispute Opened: 100.00 USD   | A dispute is opened on a merchant payment (`sendMerchantDisputeOpened`).       |
| `dispute_status_changed`    | Dispute Status Updated        | A dispute transitions to a new status (reserved — email sent, in-app pending). |
| `settlement_paid`           | Settlement Paid               | A settlement payout completes (reserved for future use).                       |
| `security_alert`            | Security Alert               | A security-sensitive event occurs, e.g. webhook disabled or API key expiring (reserved for future use). |

> **Note:** In-app notifications are created inside the merchant email-notification methods. When a merchant has email disabled for a category, the early return also skips in-app notification creation for that event.

### Notification Object

```json
{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "userId": "abc123-user-uuid",
  "type": "payment_received",
  "title": "Payment Received: 100.00 USD",
  "body": "Payment pay_abc123 — Monthly subscription",
  "link": "/payments/pay_abc123",
  "readAt": null,
  "createdAt": "2026-01-26T10:00:00.000Z"
}
```

| Field       | Type      | Description                                           |
| ----------- | --------- | ---------------------------------------------------- |
| `id`        | `string`  | UUID of the notification                             |
| `userId`    | `string`  | Merchant user ID                                     |
| `type`      | `string`  | One of the notification types above                  |
| `title`     | `string`  | Short headline                                       |
| `body`      | `string`  | Detailed message                                     |
| `link`      | `string?` | Relative URL to the relevant resource (nullable)     |
| `readAt`    | `string?` | ISO-8601 timestamp when marked read, or `null`       |
| `createdAt` | `string`  | ISO-8601 timestamp of creation                        |

### List Notifications

```
GET /v1/notifications
```

Returns up to 50 most recent notifications for the authenticated user, newest first.

**Query Parameters**

| Parameter | Type    | Required | Description                                      |
| --------- | ------- | -------- | ------------------------------------------------ |
| `unread`  | boolean | No       | When `true` or `1`, return only unread items     |

**Response — `200 OK`**

```json
[
  {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "userId": "abc123-user-uuid",
    "type": "payment_received",
    "title": "Payment Received: 100.00 USD",
    "body": "Payment pay_abc123 received",
    "link": "/payments/pay_abc123",
    "readAt": null,
    "createdAt": "2026-01-26T10:00:00.000Z"
  }
]
```

### Unread Count

```
GET /v1/notifications/unread-count
```

**Response — `200 OK`**

```json
{ "count": 3 }
```

### Mark a Notification as Read

```
POST /v1/notifications/:id/read
```

Marks a single notification as read. If the notification is already read, it is returned unchanged. Returns `404` if the notification does not belong to the authenticated user.

**Response — `200 OK`**

Returns the updated notification object.

### Mark All as Read

```
POST /v1/notifications/read-all
```

Marks every unread notification for the authenticated user as read in a single update.

**Response — `200 OK`**

```json
{ "updated": 5 }
```

---

## Email Notification Preferences

Merants control which transactional emails they receive through per-category opt-in flags. Preferences are scoped to the authenticated user.

### Preference Categories

| Category     | Key          | Default | Can disable? | Emails gated                                                                 |
| ------------ | ------------ | ------- | ------------ | ---------------------------------------------------------------------------- |
| Payments     | `payments`   | `true`  | Yes          | Payment received (merchant)                                                  |
| Refunds      | `refunds`    | `true`  | Yes          | Refund issued (merchant)                                                     |
| Disputes     | `disputes`   | `true`  | Yes          | Dispute opened (merchant)                                                    |
| Settlements  | `settlements`| `true`  | Yes          | Settlement-related emails (reserved — no email currently checks this flag)  |
| Security     | `security`   | `true`  | No           | Security alerts, webhook endpoint disabled, API key expiry warnings         |
| Reports      | `reports`    | `true`  | Yes          | Scheduled report summaries                                                   |

> **Security is always enabled.** Any value submitted for the `security` category in a PATCH request is silently ignored.

### Get Preferences

```
GET /v1/users/me/notification-preferences
```

Returns the current preference map. Categories without an explicit database row report the default (`true`); `security` is always `true`.

**Response — `200 OK`**

```json
{
  "payments": true,
  "refunds": true,
  "disputes": true,
  "settlements": true,
  "security": true,
  "reports": false
}
```

### Update Preferences

```
PATCH /v1/users/me/notification-preferences
```

Toggle one or more categories. Omitted fields are left unchanged. The `security` category cannot be modified.

**Request Body** (all fields optional)

```json
{
  "payments": true,
  "refunds": false,
  "disputes": true,
  "settlements": true,
  "reports": false
}
```

| Field        | Type      | Required | Description                          |
| ------------ | --------- | -------- | ------------------------------------ |
| `payments`   | `boolean` | No       | Toggle payment emails                |
| `refunds`    | `boolean` | No       | Toggle refund emails                 |
| `disputes`   | `boolean` | No       | Toggle dispute emails                |
| `settlements`| `boolean` | No       | Toggle settlement emails            |
| `reports`    | `boolean` | No       | Toggle report summary emails        |

**Response — `200 OK`**

Returns the full preference map after the update.

---

## Email Events and Preference Suppression

The table below maps each merchant-facing email to the preference category that gates it. Emails sent to payers (customers) are not affected by merchant preferences.

| Email                              | Recipient  | Gated by      | In-app notification created? |
| --------------------------------- | ---------- | ------------- | ---------------------------- |
| Payment received                   | Merchant   | `payments`    | Yes — `payment_received`     |
| Refund issued                      | Merchant   | `refunds`      | Yes — `refund_issued`        |
| Dispute opened                     | Merchant   | `disputes`     | Yes — `dispute_opened`       |
| Dispute status changed             | Merchant   | —             | No                           |
| Dispute response reminder          | Merchant   | —             | No                           |
| Dispute escalated                 | Admin      | —             | No                           |
| Volume limit warning               | Merchant   | —             | No                           |
| Webhook endpoint disabled          | Merchant   | —             | No                           |
| API key expiry warning             | Merchant   | —             | No                           |
| Scheduled report summary           | Merchant   | `reports`      | No                           |
| Refund approval requested          | Merchant   | —             | No                           |
| Refund approved / rejected         | Merchant   | —             | No                           |
| Invoice created                    | Payer      | —             | No                           |
| Invoice reminder                   | Payer      | —             | No                           |
| Payment confirmed                  | Payer      | —             | No                           |
| Refund processed                   | Payer      | —             | No                           |
| Recurring payment reminder         | Payer      | —             | No                           |

When a merchant has a category disabled, the corresponding email method returns early and no in-app notification is created for that event either.

---

## Architecture

- **In-app notifications** are stored in the `in_app_notifications` table and exposed via the `/v1/notifications` endpoints. They are created synchronously inside merchant email-notification methods.
- **Transactional emails** are queued via BullMQ (`emails` queue) and processed by the email processor, which renders MJML templates and sends through the configured SMTP provider. Each email is logged in the `email_logs` table with delivery status tracking.
- **Preferences** are stored in the `notification_preferences` table, keyed by `(userId, category)`. The `isEmailEnabled` helper checks the stored flag (defaulting to `true` when no row exists) and always returns `true` for the `security` category.
