import type { ServiceStatus } from './types.js';

export function renderStatusTable(rows: ServiceStatus[]): string {
  if (rows.length === 0) return '(no services configured)';
  const headers = ['NAME', 'STATE', 'PID', 'RESTARTS', 'LAST EXIT', 'COMMAND'];
  const data: string[][] = rows.map((r) => [
    r.name,
    r.state,
    r.pid === null ? '-' : String(r.pid),
    String(r.restarts),
    r.lastExitCode === null ? '-' : String(r.lastExitCode),
    truncate(r.command, 50),
  ]);
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...data.map((row) => (row[i] ?? '').length)),
  );
  const fmt = (row: string[]): string =>
    row.map((cell, i) => cell.padEnd(widths[i] ?? cell.length)).join('  ');
  return [fmt(headers), ...data.map(fmt)].join('\n');
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}
