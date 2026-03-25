/** AG Grid `colId` for the synthetic line-number column (not stored in row data). */
export const JSONL_LINE_NUMBER_COL_ID = 'jsonl-line-no';

let lineNumbersVisible = true;

export function getLineNumbersEnabled(): boolean {
  return lineNumbersVisible;
}

export function setLineNumbersVisiblePreference(visible: boolean): void {
  lineNumbersVisible = visible;
}
