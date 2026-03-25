import { describe, expect, it } from 'vitest';
import {
  COLUMN_MAX_WIDTH_PX,
  parseColumnWidthUserInput,
} from '../../src/webview/columnWidthInput';

describe('parseColumnWidthUserInput', () => {
  it('parses integer and clamps to minWidth', () => {
    expect(parseColumnWidthUserInput('100', 60)).toBe(100);
    expect(parseColumnWidthUserInput('40', 60)).toBe(60);
    expect(parseColumnWidthUserInput('  200  ', 60)).toBe(200);
  });

  it('returns null for invalid input', () => {
    expect(parseColumnWidthUserInput('', 60)).toBe(null);
    expect(parseColumnWidthUserInput('abc', 60)).toBe(null);
    expect(parseColumnWidthUserInput('12.5', 60)).toBe(null);
    expect(parseColumnWidthUserInput('-1', 60)).toBe(null);
  });

  it('caps at maximum', () => {
    expect(parseColumnWidthUserInput('999999', 60)).toBe(COLUMN_MAX_WIDTH_PX);
  });
});
