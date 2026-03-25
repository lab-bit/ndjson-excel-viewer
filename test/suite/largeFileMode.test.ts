import { describe, expect, it } from 'vitest';
import {
  LARGE_FILE_MODE_THRESHOLDS,
  shouldEnableLargeFileMode,
} from '../../src/largeFileMode';

describe('shouldEnableLargeFileMode', () => {
  it('enables large file mode when file size exceeds the threshold', () => {
    expect(
      shouldEnableLargeFileMode({
        fileSizeBytes: LARGE_FILE_MODE_THRESHOLDS.fileSizeBytes,
        totalRows: 10,
        totalColumns: 10,
      })
    ).toBe(true);
  });

  it('enables large file mode when row count exceeds the threshold', () => {
    expect(
      shouldEnableLargeFileMode({
        fileSizeBytes: 1024,
        totalRows: LARGE_FILE_MODE_THRESHOLDS.totalRows,
        totalColumns: 10,
      })
    ).toBe(true);
  });

  it('enables large file mode when column count exceeds the threshold', () => {
    expect(
      shouldEnableLargeFileMode({
        fileSizeBytes: 1024,
        totalRows: 10,
        totalColumns: LARGE_FILE_MODE_THRESHOLDS.totalColumns,
      })
    ).toBe(true);
  });

  it('keeps normal mode below every threshold', () => {
    expect(
      shouldEnableLargeFileMode({
        fileSizeBytes: LARGE_FILE_MODE_THRESHOLDS.fileSizeBytes - 1,
        totalRows: LARGE_FILE_MODE_THRESHOLDS.totalRows - 1,
        totalColumns: LARGE_FILE_MODE_THRESHOLDS.totalColumns - 1,
      })
    ).toBe(false);
  });
});
