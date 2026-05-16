/** Human byte size (binary units). `n/a` for null. Shared by inspect/status/top. */
export function fmtBytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return 'n/a';
  if (n < 1024) return `${String(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}

/** A percentage like `12.3%`, or `—` when unavailable. */
export function fmtPercent(n: number | null | undefined): string {
  return n === null || n === undefined ? '—' : `${n.toFixed(1)}%`;
}

/**
 * Human relative time from an ISO-8601 timestamp, e.g. "10 minutes ago",
 * "just now", "3 days ago". Returns null for missing/unparseable input so the
 * caller can omit the clause entirely.
 */
export function fmtAgo(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 0) return 'just now';
  if (secs < 45) return 'just now';
  const units: Array<[string, number]> = [
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
    ['second', 1],
  ];
  for (const [name, size] of units) {
    if (secs >= size) {
      const n = Math.round(secs / size);
      return `${String(n)} ${name}${n === 1 ? '' : 's'} ago`;
    }
  }
  return 'just now';
}
