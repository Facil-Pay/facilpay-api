const SECRET = /secret|password|passwd|token|authorization|cookie|credential|api.?key|private.?key|backup.?code|otp|saml|assertion|signature|card|cvv|account.?number/i;
// Only known non-sensitive string values are retained. Unknown/free-text fields can contain credentials.
const SAFE_STRING = /^(currency|status|method|environment|type|network)$/i;
export function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value == null) return null;
  if (depth > 8) return '[TRUNCATED]';
  if (typeof value === 'string') return '[REDACTED]';
  if (typeof value !== 'object') return typeof value === 'number' || typeof value === 'boolean' ? value : null;
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 100).map(item => redact(item, depth + 1, seen));
  const output: Record<string, unknown> = Object.create(null);
  for (const [key, item] of Object.entries(value).slice(0, 100)) {
    // Unrecognized property names can themselves contain credentials.
    if (key.length > 64 || !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key)) continue;
    output[key] = SECRET.test(key) ? '[REDACTED]' : typeof item === 'string' && SAFE_STRING.test(key) && /^[a-zA-Z_-]{1,32}$/.test(item)
      ? item : redact(item, depth + 1, seen);
  }
  return output;
}
