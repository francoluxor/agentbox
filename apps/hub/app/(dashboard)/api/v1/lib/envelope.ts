// One consistent JSON envelope for the whole public API. Success returns the
// resource/collection directly (stable, documented shapes); errors always return
// `{ error: { code, message, details? } }` with a correct HTTP status — never the
// exit-code-coupled statuses the internal relay surface uses.

export type ApiErrorCode =
  | 'invalid_request'
  | 'not_found'
  | 'unauthorized'
  | 'backend_unavailable'
  | 'conflict'
  | 'internal';

const STATUS_HINT: Record<ApiErrorCode, number> = {
  invalid_request: 400,
  unauthorized: 401,
  not_found: 404,
  conflict: 409,
  backend_unavailable: 503,
  internal: 500,
};

export function ok(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

export function fail(code: ApiErrorCode, message: string, details?: unknown): Response {
  const status = STATUS_HINT[code];
  return Response.json({ error: { code, message, ...(details === undefined ? {} : { details }) } }, { status });
}

// Map a backend ActionResult error into an envelope. "not found" style errors
// become 404; everything else is a 409 conflict (the op was rejected by the
// provider/state, not a client-input problem).
export function failFromAction(error: string): Response {
  const notFound = /not found|unknown|no such|does not exist/i.test(error);
  return fail(notFound ? 'not_found' : 'conflict', error);
}
