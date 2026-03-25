/** A single record (one line of JSONL) */
export type JsonlRecord = Record<string, unknown>;

/** Parse result */
export interface ParseResult {
  records: JsonlRecord[];
  errors: ParseError[];
}

/** Parse error for a specific line */
export interface ParseError {
  line: number;
  raw: string;
  message: string;
}

/** Column type */
export type ColumnType = 'string' | 'number' | 'boolean' | 'date' | 'subtable' | 'object' | 'unknown';

/** Column definition for AG Grid */
export interface ColumnDef {
  field: string;
  headerName: string;
  type: ColumnType;
  isSubtable: boolean;
  width?: number;
}

/** Cell edit operation */
export interface CellEdit {
  rowIndex: number;
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface GridStats {
  fileSizeBytes: number;
  totalRows: number;
  totalColumns: number;
}

export interface SearchMatch {
  rowIndex: number;
  colId: string;
}

export interface SearchResultSummary {
  query: string;
  totalMatches: number;
  currentMatchIndex: number;
}

/** Messages from Extension Host to Webview */
export type ExtToWebviewMessage =
  | {
      type: 'init';
      columns: ColumnDef[];
      totalRows: number;
      largeFileMode: boolean;
      stats: GridStats;
    }
  | {
      type: 'rows-range';
      requestId: number;
      startRow: number;
      endRow: number;
      rows: JsonlRecord[];
      lastRow: number;
    }
  | { type: 'apply-edit'; edit: CellEdit }
  | { type: 'search-result'; result: SearchResultSummary }
  | { type: 'focus-match'; match: SearchMatch }
  | { type: 'theme-changed'; theme: string };

/** Messages from Webview to Extension Host */
export type WebviewToExtMessage =
  | { type: 'ready' }
  | { type: 'cell-edit'; edit: CellEdit }
  | { type: 'request-rows'; requestId: number; startRow: number; endRow: number }
  | { type: 'search-query'; query: string }
  | { type: 'search-step'; direction: 'next' | 'prev' };
