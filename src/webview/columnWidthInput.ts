export const COLUMN_MAX_WIDTH_PX = 32000;

/**
 * Parse user input for column width (px). Clamps to minWidth..MAX_COLUMN_WIDTH_PX.
 * Returns null if not a finite positive integer.
 */
export function parseColumnWidthUserInput(raw: string, minWidth: number): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return null;
  const min = Math.max(1, Math.floor(minWidth));
  return Math.min(COLUMN_MAX_WIDTH_PX, Math.max(min, n));
}
