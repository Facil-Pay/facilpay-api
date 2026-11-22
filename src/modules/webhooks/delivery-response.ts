export const RESPONSE_BODY_MAX_LENGTH = 1024;

/**
 * Turns an endpoint's response payload into a short string that is safe to
 * store: serialised if needed, stripped of NUL bytes (Postgres text rejects
 * them) and cut to RESPONSE_BODY_MAX_LENGTH characters.
 */
export function truncateResponseBody(data: unknown): string | null {
  if (data === undefined || data === null) return null;

  let text: string | undefined;
  if (typeof data === 'string') {
    text = data;
  } else {
    try {
      text = JSON.stringify(data);
    } catch {
      return null;
    }
  }
  if (!text) return null;

  text = text.split('\u0000').join('');
  return text.length > RESPONSE_BODY_MAX_LENGTH
    ? `${text.slice(0, RESPONSE_BODY_MAX_LENGTH)}…`
    : text;
}
