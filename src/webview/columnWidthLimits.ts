import type { GridApi } from 'ag-grid-community';

/** Ratio of viewport width used to cap initial autosized column width (approx. 80vw). */
export const COLUMN_MAX_WIDTH_VIEWPORT_RATIO = 0.8;

/** Minimum cap in px when applying initial autosize clamp (narrow webview / devtools). */
export const COLUMN_MAX_WIDTH_MIN_PX = 200;

/**
 * Target max width in px after autosize (not a hard resize limit — use {@link clampAutosizedColumnWidths}).
 */
export function getColumnMaxWidthPx(): number {
  if (typeof window === 'undefined') {
    return 1200;
  }
  return Math.max(
    COLUMN_MAX_WIDTH_MIN_PX,
    Math.floor(window.innerWidth * COLUMN_MAX_WIDTH_VIEWPORT_RATIO)
  );
}

/**
 * Shrinks columns that autosize wider than the viewport cap. Does not set `maxWidth`, so users can still drag wider.
 */
export function clampAutosizedColumnWidths(api: GridApi): void {
  const cap = getColumnMaxWidthPx();
  const cols = api.getAllDisplayedColumns();
  if (!cols?.length) return;
  const widths: { key: string; newWidth: number }[] = [];
  for (const col of cols) {
    if (col.getActualWidth() > cap) {
      widths.push({ key: col.getColId(), newWidth: cap });
    }
  }
  if (widths.length > 0) {
    api.setColumnWidths(widths);
  }
}
