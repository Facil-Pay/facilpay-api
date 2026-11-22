# Observability

This document covers how to monitor the FacilPay API in production using metrics, tracing, and structured logging.

## Metrics

The API exposes Prometheus metrics at `GET /metrics`. These metrics track HTTP request performance, queue health, payment operations, and webhook delivery.

### Exposed Metrics

| Metric Name | Type | Labels | Description |
|------------|------|--------|-------------|
| `http_request_duration_seconds` | Histogram | `method`, `route`, `status_code` | HTTP request latency in seconds |
| `http_requests_total` | Counter | `method`, `route`, `status_code` | Total HTTP requests |
| `bullmq_queue_depth` | Gauge | `queue_name` | Number of jobs in queue |
| `bullmq_jobs_failed_total` | Counter | `queue_name` | Total failed BullMQ jobs |
| `payments_created_total` | Counter | `currency` | Total payments created |
| `payments_completed_total` | Counter | `currency`, `status` | Total payments completed |
| `webhook_delivery_success_total` | Counter | `event_type` | Total successful webhook deliveries |
| `webhook_delivery_failure_total` | Counter | `event_type`, `status_code` | Total failed webhook deliveries |

In addition to the custom metrics above, default Node.js metrics (CPU, memory, event loop lag, etc.) are automatically collected.

### Histogram Buckets

The `http_request_duration_seconds` histogram uses the following buckets (in seconds):

```
[0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5]
```

These cover latencies from 1ms to 5 seconds.

### Example Prometheus Scrape Config

Add this job to your Prometheus configuration:

```yaml
scrape_configs:
  - job_name: 'facilpay-api'
    scrape_interval: 15s
    static_configs:
      - targets: ['api:3000']
    metrics_path: /metrics
```

Replace `api:3000` with your actual API hostname and port.

### Grafana Panel Ideas

**Request Rate by Route**
```promql
sum(rate(http_requests_total[5m])) by (route, method)
```

**Request Latency (p95)**
```promql
histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, route))
```

**Error Rate**
```promql
sum(rate(http_requests_total{status_code=~"5.."}[5m])) by (route)
```

**Queue Depth**
```promql
bullmq_queue_depth
```

**Webhook Success Rate**
```promql
sum(rate(webhook_delivery_success_total[5m])) by (event_type)
/ (sum(rate(webhook_delivery_success_total[5m])) by (event_type) + sum(rate(webhook_delivery_failure_total[5m])) by (event_type))
```

## Tracing

OpenTelemetry tracing is configured in `src/tracing.ts`. When enabled, the API exports distributed traces to an OTLP-compatible backend (e.g., Jaeger, Honeycomb, or Grafana Tempo).

### Configuration

Tracing is **disabled by default**. To enable it, set the `OTEL_EXPORTER_OTLP_ENDPOINT` environment variable:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318/v1/traces
```

This should point to your OTLP HTTP receiver endpoint.

### Environment Variables

| Variable | Description | Default | Example |
|----------|-------------|---------|---------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP HTTP exporter endpoint (required to enable tracing) | *(empty — tracing disabled)* | `http://otel-collector:4318/v1/traces` |

See [docs/ENVIRONMENT.md](./ENVIRONMENT.md) for the complete list of environment variables.

### Auto-Instrumentation

The API uses `@opentelemetry/auto-instrumentations-node` to automatically instrument:

- HTTP/HTTPS requests and responses
- Database queries (TypeORM)
- Redis operations
- BullMQ jobs

No manual span creation is required for these operations.

### Manual Tracing

For custom traces, use the `runWithTrace` helper:

```typescript
import { runWithTrace } from '../../tracing';

const result = runWithTrace('my-operation', () => {
  // Your code here
  return someValue;
});
```

### Trace ID Propagation

Trace IDs are automatically propagated to structured logs via the `traceId` field (see Logging section below).

## Logging

The API uses Pino for structured JSON logging. Logs are written to rotating files in the `logs/` directory and optionally pretty-printed to the console in development.

### Log Format

Every log entry includes:

| Field | Description | Example |
|-------|-------------|---------|
| `level` | Log level (`debug`, `info`, `warn`, `error`) | `info` |
| `time` | ISO 8601 timestamp | `2026-10-17T10:00:00.000Z` |
| `msg` | Log message | `Recurring payment charge created` |
| `service` | Service name | `facilpay-api` |
| `environment` | Environment name | `production` |
| `correlationId` | Request correlation ID (UUID) | `123e4567-e89b-12d3-a456-426614174000` |
| `traceId` | OpenTelemetry trace ID (if tracing enabled) | `4bf92f3577b34da6a3ce929d0e0e4736` |
| `context` | Logger context (e.g., class name) | `RecurringPaymentsService` |
| `module` | Module name (for scoped loggers) | `RecurringPaymentsService` |

Additional fields may be included depending on the log entry (e.g., `planId`, `paymentId`, `error`).

### Correlation ID Propagation

The correlation ID is automatically generated for each HTTP request and stored in async context. It propagates through:

- All log entries during the request lifecycle
- Downstream HTTP calls (via `X-Correlation-ID` header)
- Webhook deliveries
- Background jobs

Clients can provide their own correlation ID by sending the `X-Correlation-ID` header.

### Log Levels

- `debug` — Verbose output for development (default in `NODE_ENV=development`)
- `info` — Normal operational messages (default in production)
- `warn` — Recoverable issues or unexpected conditions
- `error` — Errors that require attention

### Environment Variables

| Variable | Description | Default | Example |
|----------|-------------|---------|---------|
| `LOG_LEVEL` | Pino log level | `debug` (dev), `info` (prod) | `info` |
| `LOG_DIR` | Directory for rotating log files | `logs` | `logs` |
| `LOG_PRETTY` | Pretty-print logs to console | `true` (dev), `false` (prod) | `false` |
| `LOG_MAX_SIZE` | Max size per log file | `10m` | `10m` |
| `LOG_RETENTION_DAYS` | Days to retain log files | `14` | `14` |
| `LOG_BODY` | Log request bodies | `false` | `false` |
| `LOG_BODY_MAX_LENGTH` | Max request body length logged | `2048` | `2048` |
| `LOG_RESPONSE_BODY` | Log response bodies | `false` | `false` |

See [docs/ENVIRONMENT.md](./ENVIRONMENT.md) for details.

### Querying Logs

Since logs are structured JSON, you can use tools like `jq` to filter and analyze them:

**Find all errors for a specific correlation ID:**
```bash
cat logs/app.log | jq 'select(.correlationId == "123e4567-e89b-12d3-a456-426614174000" and .level == "error")'
```

**Count log entries by level:**
```bash
cat logs/app.log | jq -r '.level' | sort | uniq -c
```

**Extract all trace IDs:**
```bash
cat logs/app.log | jq -r '.traceId' | grep -v null | sort -u
```

### Centralized Logging

For production deployments, ship logs to a centralized logging system (e.g., Loki, Elasticsearch, Datadog) using a log forwarder like Fluentd or Vector.

Example Fluentd config snippet:

```xml
<source>
  @type tail
  path /app/logs/app.log
  pos_file /var/log/td-agent/facilpay-api.pos
  tag facilpay.api
  <parse>
    @type json
    time_key time
    time_format %Y-%m-%dT%H:%M:%S.%L%z
  </parse>
</source>

<match facilpay.api>
  @type loki
  url http://loki:3100
  extra_labels {"service":"facilpay-api"}
  <label>
    level
    correlationId
    traceId
  </label>
</match>
```

## Implementation Details

### Metrics

Metrics are implemented in `src/modules/metrics/metrics.service.ts` using the `prom-client` library. The service provides methods like:

- `recordHttpRequest(method, route, statusCode, duration)`
- `recordPaymentCreated(currency)`
- `recordWebhookDeliverySuccess(eventType)`
- `setQueueDepth(queueName, depth)`

These are called from middleware, services, and workers throughout the application.

### Tracing

Tracing initialization happens in `src/tracing.ts` via `initializeTracing()`, which is called in `src/main.ts` before the NestJS app starts. The OTLP exporter sends traces over HTTP using the `BatchSpanProcessor` for efficient batching.

### Logging

The structured logger is implemented in `src/modules/logger/logger.service.ts` using Pino. Correlation IDs are managed via async context in `src/modules/logger/correlation-id.context.ts`. The logger automatically attaches `correlationId` and `traceId` to every log entry.

---

For further details on environment configuration, see [docs/ENVIRONMENT.md](./ENVIRONMENT.md).
