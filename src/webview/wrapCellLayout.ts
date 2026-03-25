/** Applied to ColDef.cellClass when wrap mode uses fixed row height + inner scroll. */
export const WRAP_CELL_SCROLL_CLASS = 'jsonl-cell-wrap-scroll';

/** Max height of the scrollable `.ag-cell-value` area when wrap is on (px). */
export const WRAP_CELL_MAX_CONTENT_HEIGHT_PX = 120;

/**
 * Fixed grid row height when wrap is on (inner max + typical cell vertical padding).
 */
export const WRAP_MODE_ROW_HEIGHT_PX = WRAP_CELL_MAX_CONTENT_HEIGHT_PX + 16;

/** Vertical padding/border budget subtracted from row height to get scrollable `.ag-cell-value` max-height. */
export const WRAP_ROW_VERTICAL_CHROME_PX =
  WRAP_MODE_ROW_HEIGHT_PX - WRAP_CELL_MAX_CONTENT_HEIGHT_PX;

/** Do not shrink the inner scroll area below this (px). */
export const WRAP_SCROLL_CELL_VALUE_MIN_PX = 48;

/** CSS custom property set on `.ag-row` when wrap + scroll cells are used (see `media/styles.css`). */
export const WRAP_CELL_VALUE_MAX_HEIGHT_CSS_VAR = '--jsonl-wrap-cell-value-max-h';

/**
 * Max height for `.ag-cell-value` inside wrap-scroll cells, from the row's rendered height.
 */
export function wrapScrollCellValueMaxHeightPx(rowHeightPx: number): number {
  const raw = rowHeightPx - WRAP_ROW_VERTICAL_CHROME_PX;
  return Math.max(WRAP_SCROLL_CELL_VALUE_MIN_PX, Math.round(raw));
}

/** Default row height for inline nested grids when wrap is off (DetailRenderer). */
export const NEST_GRID_ROW_HEIGHT_DEFAULT_PX = 24;

/** Default row height for subtable modal/dock panel when wrap is off (theme row height). */
export const SUBTABLE_PANEL_ROW_HEIGHT_DEFAULT_PX = 28;
