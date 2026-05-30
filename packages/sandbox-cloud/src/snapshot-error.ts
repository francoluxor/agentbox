/**
 * Detect the "the snapshot I tried to boot from is gone" failure across cloud
 * backends. Vercel surfaces it as an `APIError` with HTTP 410 ("Gone") and a
 * body of `{ error: { message: 'Snapshot expired or deleted.' } }`; other
 * backends phrase it differently. We match on the status code and a few
 * message shapes so the create path can fall back to a from-scratch box
 * instead of crashing when a base/checkpoint snapshot has been reaped.
 */
export function isSnapshotGoneError(err: unknown): boolean {
  if (err === null || typeof err !== 'object') return false;
  const e = err as {
    status?: unknown;
    response?: { status?: unknown };
    json?: { error?: { message?: unknown } };
    message?: unknown;
  };
  const status = e.response?.status ?? e.status;
  if (status === 410) return true;
  const parts = [
    typeof e.json?.error?.message === 'string' ? e.json.error.message : '',
    typeof e.message === 'string' ? e.message : '',
  ];
  const msg = parts.join(' ').toLowerCase();
  return (
    /snapshot[^.]*\b(expired|deleted|gone|not[ -]?found)\b/.test(msg) ||
    msg.includes('expired or deleted')
  );
}
