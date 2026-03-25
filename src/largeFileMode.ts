export interface LargeFileModeStats {
  fileSizeBytes: number;
  totalRows: number;
  totalColumns: number;
}

export const LARGE_FILE_MODE_THRESHOLDS = {
  fileSizeBytes: 5 * 1024 * 1024,
  totalRows: 1000,
  totalColumns: 100,
} as const;

export function shouldEnableLargeFileMode(
  stats: LargeFileModeStats
): boolean {
  return (
    stats.fileSizeBytes >= LARGE_FILE_MODE_THRESHOLDS.fileSizeBytes ||
    stats.totalRows >= LARGE_FILE_MODE_THRESHOLDS.totalRows ||
    stats.totalColumns >= LARGE_FILE_MODE_THRESHOLDS.totalColumns
  );
}

