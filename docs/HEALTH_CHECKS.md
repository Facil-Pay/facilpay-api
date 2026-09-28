# Health Checks & Orchestrator Probe Guide

FacilPay API exposes three health endpoints under `src/modules/health/health.controller.ts` (`@Controller('v1/health')`) to support container orchestrators (Kubernetes, Docker Compose, ECS) and uptime monitors without triggering restart loops during transient external outages.

---

## Endpoint Summary

| Endpoint | Purpose | Outbound Calls | HTTP Status Codes | Recommended Use |
| :--- | :--- | :--- | :--- | :--- |
| `GET /v1/health/live` | **Liveness Probe** | None (in-process only) | `200 OK` | Kubernetes `livenessProbe`, container restart decisions |
| `GET /v1/health/ready` | **Readiness Probe** | PostgreSQL, Stellar Horizon, Redis/BullMQ | `200 OK` (`ok` / `degraded`), `503 Service Unavailable` (`unhealthy`) | Kubernetes `readinessProbe`, load balancer target health |
| `GET /v1/health` | **Detailed Health Report** | PostgreSQL, Stellar Horizon, Redis/BullMQ | `200 OK` (`ok` / `degraded`), `503 Service Unavailable` (`unhealthy`) | Operational dashboards, synthetic monitoring, CLI diagnostics |

> **Why separate liveness from readiness?**
> Wiring `GET /v1/health` or `GET /v1/health/ready` to a Kubernetes `livenessProbe` can cause cascading container restart loops when external dependencies (PostgreSQL, Redis, or Stellar Horizon) experience transient network issues. Always wire `livenessProbe` to `GET /v1/health/live` and `readinessProbe` to `GET /v1/health/ready`.

---

## 1. Liveness Probe (`GET /v1/health/live`)

Confirms that the Node.js event loop and NestJS HTTP server are responsive. Performs **no** database queries or network requests.

### Request
```bash
curl -i http://localhost:3000/v1/health/live
```

### Response (`200 OK`)
```json
{
  "status": "ok",
  "statusCode": 200,
  "timestamp": "2026-01-26T10:00:00.000Z",
  "uptime": 3600
}
```

---

## 2. Readiness Probe (`GET /v1/health/ready` & `GET /v1/health`)

Evaluates all backing subsystems via `HealthService.check()` and returns a structured report covering database connectivity, Stellar Horizon reachability, Horizon SSE streaming state, Horizon URL pool state, BullMQ/Redis connectivity, and host memory metrics.

### Request
```bash
curl -i http://localhost:3000/v1/health/ready
```

### Example Response — Healthy (`200 OK`)
```json
{
  "status": "ok",
  "statusCode": 200,
  "timestamp": "2026-01-26T10:00:00.000Z",
  "uptime": 3600,
  "services": {
    "database": {
      "status": "healthy",
      "message": "Database connection is healthy"
    },
    "stellar": {
      "status": "healthy",
      "message": "Stellar network is reachable"
    },
    "horizonStream": {
      "status": "connected",
      "message": "Horizon SSE stream is active"
    },
    "horizonUrls": [
      {
        "url": "https://horizon-testnet.stellar.org",
        "healthy": true,
        "errorCount": 0,
        "lastChecked": "2026-01-26T10:00:00.000Z"
      }
    ],
    "queue": {
      "status": "healthy",
      "message": "Redis connection is healthy"
    },
    "system": {
      "memory": {
        "used": 536870912,
        "total": 8589934592,
        "percentUsed": 6.25
      },
      "uptime": 3600
    }
  }
}
```

### Example Response — Degraded (`200 OK`)
When one or two of the three core dependencies (`database`, `stellar`, `queue`) are unhealthy while at least one remains healthy, `HealthService.check()` reports `"status": "degraded"` with HTTP `200`:
```json
{
  "status": "degraded",
  "statusCode": 200,
  "timestamp": "2026-01-26T10:00:00.000Z",
  "uptime": 3600,
  "services": {
    "database": {
      "status": "healthy",
      "message": "Database connection is healthy"
    },
    "stellar": {
      "status": "unhealthy",
      "message": "Stellar network is unreachable"
    },
    "horizonStream": {
      "status": "disconnected",
      "message": "Horizon SSE stream is not connected"
    },
    "queue": {
      "status": "healthy",
      "message": "Redis connection is healthy"
    },
    "system": {
      "memory": {
        "used": 536870912,
        "total": 8589934592,
        "percentUsed": 6.25
      },
      "uptime": 3600
    }
  }
}
```

### Example Response — Unhealthy (`503 Service Unavailable`)
When all three core dependencies (`database`, `stellar`, `queue`) fail simultaneously, `HealthController` throws `ServiceUnavailableException` (`503 Service Unavailable`):
```json
{
  "status": "unhealthy",
  "statusCode": 503,
  "timestamp": "2026-01-26T10:00:00.000Z",
  "uptime": 3600,
  "services": {
    "database": {
      "status": "unhealthy",
      "message": "Database not initialized"
    },
    "stellar": {
      "status": "unhealthy",
      "message": "Stellar network unreachable"
    },
    "horizonStream": {
      "status": "disconnected",
      "message": "Horizon SSE stream is not connected"
    },
    "queue": {
      "status": "unhealthy",
      "message": "connect ECONNREFUSED 127.0.0.1:6379"
    },
    "system": {
      "memory": {
        "used": 536870912,
        "total": 8589934592,
        "percentUsed": 6.25
      },
      "uptime": 3600
    }
  }
}
```

---

## 3. Critical vs. Degraded-Only Dependencies

`HealthService.check()` evaluates six subsystem blocks with distinct impact on overall status:

1. **Core Dependencies (`database`, `stellar`, `queue`)**:
   - **`database`** (PostgreSQL via TypeORM `SELECT 1`): Evaluates whether the primary relational store is initialized and responding.
   - **`stellar`** (Stellar Horizon `GET ${STELLAR_HORIZON_URL}/health` with 5s timeout): Evaluates whether the configured Horizon endpoint is reachable.
   - **`queue`** (BullMQ `webhooks` queue Redis client `PING` -> `PONG`): Evaluates whether Redis is reachable for background job processing.
   - **Status Aggregation Rule**:
     - **`ok` (`200 OK`)**: All three (`database`, `stellar`, `queue`) report `healthy`.
     - **`degraded` (`200 OK`)**: One or two of (`database`, `stellar`, `queue`) report `unhealthy`, while at least one remains `healthy`.
     - **`unhealthy` (`503 Service Unavailable`)**: All three (`database`, `stellar`, `queue`) report `unhealthy`.

2. **Observability & Non-Blocking Subsystems (`horizonStream`, `horizonUrls`, `system`)**:
   - **`horizonStream`**: Reports `connected`, `disconnected`, or `disabled` (when `STELLAR_MERCHANT_ACCOUNT_ID` is unset). Does **not** flip the top-level status to `degraded` or `503` on its own.
   - **`horizonUrls`**: Reports per-endpoint health and error counts from `StellarHorizonClientService`. Informational only.
   - **`system`**: Reports host RAM usage (`used`, `total`, `percentUsed`) and process `uptime`. Informational only.

---

## 4. Deployment Examples

### Kubernetes `Deployment` Probe Configuration

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: facilpay-api
spec:
  replicas: 2
  selector:
    matchLabels:
      app: facilpay-api
  template:
    metadata:
      labels:
        app: facilpay-api
    spec:
      containers:
        - name: api
          image: facilpay/facilpay-api:latest
          ports:
            - containerPort: 3000
              name: http
          livenessProbe:
            httpGet:
              path: /v1/health/live
              port: http
            initialDelaySeconds: 15
            periodSeconds: 10
            timeoutSeconds: 3
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /v1/health/ready
              port: http
            initialDelaySeconds: 10
            periodSeconds: 10
            timeoutSeconds: 6
            failureThreshold: 2
```

### Docker Compose `healthcheck` Configuration

```yaml
services:
  api:
    build:
      context: .
      target: development
    ports:
      - "${PORT:-3000}:3000"
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://localhost:3000/v1/health/live || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 20s
```
