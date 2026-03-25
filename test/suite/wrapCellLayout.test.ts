import { describe, expect, it } from 'vitest';
import {
  WRAP_CELL_MAX_CONTENT_HEIGHT_PX,
  WRAP_MODE_ROW_HEIGHT_PX,
  WRAP_ROW_VERTICAL_CHROME_PX,
  WRAP_SCROLL_CELL_VALUE_MIN_PX,
  wrapScrollCellValueMaxHeightPx,
} from '../../src/webview/wrapCellLayout';

describe('wrapCellLayout', () => {
  it('row height fits max content plus padding', () => {
    expect(WRAP_MODE_ROW_HEIGHT_PX).toBeGreaterThan(WRAP_CELL_MAX_CONTENT_HEIGHT_PX);
  });

  it('chrome matches default row vs content max delta', () => {
    expect(WRAP_ROW_VERTICAL_CHROME_PX).toBe(
      WRAP_MODE_ROW_HEIGHT_PX - WRAP_CELL_MAX_CONTENT_HEIGHT_PX
    );
  });

  it('wrapScrollCellValueMaxHeightPx subtracts chrome from row height', () => {
    expect(wrapScrollCellValueMaxHeightPx(WRAP_MODE_ROW_HEIGHT_PX)).toBe(
      WRAP_CELL_MAX_CONTENT_HEIGHT_PX
    );
  });

  it('wrapScrollCellValueMaxHeightPx enforces a floor', () => {
    expect(wrapScrollCellValueMaxHeightPx(20)).toBe(WRAP_SCROLL_CELL_VALUE_MIN_PX);
  });

  it('wrapScrollCellValueMaxHeightPx rounds row height', () => {
    expect(wrapScrollCellValueMaxHeightPx(200.4)).toBe(184);
  });
});
