/** Rect in 0-based screen coordinates (top-left origin). */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DashboardLayout {
  cols: number;
  rows: number;
  sidebar: Rect;
  /** Single column separator between sidebar and right pane. */
  sepX: number;
  right: Rect;
  /** Full-width status line, single row at the bottom. */
  statusY: number;
  /** Right pane too small to host a usable terminal. */
  tooSmall: boolean;
}

export const SIDEBAR_WIDTH = 33;
const MIN_RIGHT_W = 20;
const MIN_RIGHT_H = 4;

export function computeLayout(cols: number, rows: number): DashboardLayout {
  const sidebarW = Math.min(SIDEBAR_WIDTH, Math.max(0, cols - MIN_RIGHT_W - 1));
  const sepX = sidebarW;
  const rightX = sidebarW + 1;
  const rightW = Math.max(0, cols - rightX);
  const statusY = rows - 1;
  const paneH = Math.max(0, statusY); // rows above the status line
  return {
    cols,
    rows,
    sidebar: { x: 0, y: 0, w: sidebarW, h: paneH },
    sepX,
    right: { x: rightX, y: 0, w: rightW, h: paneH },
    statusY,
    tooSmall: rightW < MIN_RIGHT_W || paneH < MIN_RIGHT_H,
  };
}
