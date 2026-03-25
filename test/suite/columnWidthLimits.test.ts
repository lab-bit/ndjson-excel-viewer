import type { GridApi } from 'ag-grid-community';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  COLUMN_MAX_WIDTH_MIN_PX,
  clampAutosizedColumnWidths,
  getColumnMaxWidthPx,
} from '../../src/webview/columnWidthLimits';

describe('getColumnMaxWidthPx', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns floor(0.8 * innerWidth) when above minimum', () => {
    vi.stubGlobal('window', { innerWidth: 1000 });
    expect(getColumnMaxWidthPx()).toBe(800);
  });

  it('enforces minimum when viewport is narrow', () => {
    vi.stubGlobal('window', { innerWidth: 100 });
    expect(getColumnMaxWidthPx()).toBe(COLUMN_MAX_WIDTH_MIN_PX);
  });
});

describe('clampAutosizedColumnWidths', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('narrows only columns wider than cap', () => {
    vi.stubGlobal('window', { innerWidth: 500 });
    const setColumnWidths = vi.fn();
    const colA = { getColId: () => 'a', getActualWidth: () => 100 };
    const colB = { getColId: () => 'b', getActualWidth: () => 500 };
    const api = {
      getAllDisplayedColumns: () => [colA, colB],
      setColumnWidths,
    };
    clampAutosizedColumnWidths(api as unknown as GridApi);
    expect(setColumnWidths).toHaveBeenCalledWith([{ key: 'b', newWidth: 400 }]);
  });
});
