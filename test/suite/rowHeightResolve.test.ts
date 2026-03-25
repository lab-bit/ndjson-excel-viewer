import { describe, expect, it } from 'vitest';
import {
  JSONL_ROW_INDEX_FIELD,
  resolveMainGridRowHeightPx,
  clampRowHeightPx,
  ROW_HEIGHT_MIN_PX,
  ROW_HEIGHT_MAX_PX,
} from '../../src/webview/rowHeightDrag';

const WRAP = 136;
const custom = new Map<number, number>([[0, 99]]);

describe('clampRowHeightPx', () => {
  it('clamps to min and max', () => {
    expect(clampRowHeightPx(10)).toBe(ROW_HEIGHT_MIN_PX);
    expect(clampRowHeightPx(9999)).toBe(ROW_HEIGHT_MAX_PX);
    expect(clampRowHeightPx(40.2)).toBe(40);
  });
});

describe('resolveMainGridRowHeightPx', () => {
  it('uses detail formula for __isDetailRow when not large file', () => {
    const h = resolveMainGridRowHeightPx({
      data: { __isDetailRow: true, __subtableData: [{}, {}] },
      largeFileMode: false,
      cellWrapEnabled: false,
      wrapModeRowHeightPx: WRAP,
      customHeights: custom,
    });
    expect(h).toBe(Math.min(Math.max(32 + 2 * 24 + 16, 120), 300));
  });

  it('ignores custom map for detail rows', () => {
    const h = resolveMainGridRowHeightPx({
      data: {
        __isDetailRow: true,
        __subtableData: [],
        [JSONL_ROW_INDEX_FIELD]: 0,
      },
      largeFileMode: false,
      cellWrapEnabled: true,
      wrapModeRowHeightPx: WRAP,
      customHeights: custom,
    });
    expect(h).toBe(120);
  });

  it('prefers custom height over wrap for normal rows', () => {
    const h = resolveMainGridRowHeightPx({
      data: { [JSONL_ROW_INDEX_FIELD]: 0, foo: 1 },
      largeFileMode: false,
      cellWrapEnabled: true,
      wrapModeRowHeightPx: WRAP,
      customHeights: custom,
    });
    expect(h).toBe(99);
  });

  it('uses wrap height when no custom for normal row', () => {
    const h = resolveMainGridRowHeightPx({
      data: { [JSONL_ROW_INDEX_FIELD]: 5, foo: 1 },
      largeFileMode: false,
      cellWrapEnabled: true,
      wrapModeRowHeightPx: WRAP,
      customHeights: custom,
    });
    expect(h).toBe(WRAP);
  });

  it('returns undefined for normal row when wrap off and no custom', () => {
    const h = resolveMainGridRowHeightPx({
      data: { [JSONL_ROW_INDEX_FIELD]: 5, foo: 1 },
      largeFileMode: false,
      cellWrapEnabled: false,
      wrapModeRowHeightPx: WRAP,
      customHeights: new Map(),
    });
    expect(h).toBeUndefined();
  });

  it('ignores custom map for normal rows when wrap off', () => {
    const h = resolveMainGridRowHeightPx({
      data: { [JSONL_ROW_INDEX_FIELD]: 0, foo: 1 },
      largeFileMode: false,
      cellWrapEnabled: false,
      wrapModeRowHeightPx: WRAP,
      customHeights: custom,
    });
    expect(h).toBeUndefined();
  });

  it('uses wrap for __isFlatDetailRow when wrap on', () => {
    const h = resolveMainGridRowHeightPx({
      data: { __isFlatDetailRow: true, [JSONL_ROW_INDEX_FIELD]: 0 },
      largeFileMode: false,
      cellWrapEnabled: true,
      wrapModeRowHeightPx: WRAP,
      customHeights: custom,
    });
    expect(h).toBe(WRAP);
  });

  it('returns undefined for __isFlatDetailRow when wrap off', () => {
    const h = resolveMainGridRowHeightPx({
      data: { __isFlatDetailRow: true, [JSONL_ROW_INDEX_FIELD]: 0 },
      largeFileMode: false,
      cellWrapEnabled: false,
      wrapModeRowHeightPx: WRAP,
      customHeights: custom,
    });
    expect(h).toBeUndefined();
  });
});
