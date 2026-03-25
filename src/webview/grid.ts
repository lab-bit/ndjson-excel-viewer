import {
  createGrid,
  type GridApi,
  type GridOptions,
  type ColDef,
  type CellValueChangedEvent,
  type IDatasource,
  type IGetRowsParams,
  type SelectionColumnDef,
  ModuleRegistry,
  ClientSideRowModelModule,
  CsvExportModule,
  CommunityFeaturesModule,
  InfiniteRowModelModule,
} from 'ag-grid-community';
import type { ColumnDef, JsonlRecord, CellEdit, SearchMatch } from '../types';
import { setCellWrapEnabledPreference, getCellWrapEnabled } from './cellWrapPreference';
import {
  getLineNumbersEnabled,
  JSONL_LINE_NUMBER_COL_ID,
  setLineNumbersVisiblePreference,
} from './lineNumberPreference';
import { getMainMenuItemsWithSetColumnWidth } from './columnMenuWidth';
import { clampAutosizedColumnWidths } from './columnWidthLimits';
import {
  NEST_GRID_ROW_HEIGHT_DEFAULT_PX,
  WRAP_CELL_SCROLL_CLASS,
  WRAP_CELL_VALUE_MAX_HEIGHT_CSS_VAR,
  WRAP_MODE_ROW_HEIGHT_PX,
  wrapScrollCellValueMaxHeightPx,
} from './wrapCellLayout';
import {
  autoSizeClampActiveSubtablePanel,
  createSubtableCellRenderer,
  refreshActivePanelCellWrap,
} from './subtableRenderer';
import {
  clearCustomRowHeights,
  createLeadColumnCellRenderer,
  createSelectionColumnWithGripRenderer,
  DEFAULT_THEME_ROW_HEIGHT_PX,
  JSONL_ROW_INDEX_FIELD,
  resolveRowHeightForGrid,
} from './rowHeightDrag';

ModuleRegistry.registerModules([
  ClientSideRowModelModule,
  CsvExportModule,
  CommunityFeaturesModule,
  InfiniteRowModelModule,
]);

const LARGE_FILE_BLOCK_SIZE = 200;
const INTERNAL_ROW_INDEX_FIELD = JSONL_ROW_INDEX_FIELD;

function flattenArrayToSearchText(value: unknown): string {
  if (!Array.isArray(value)) return value != null ? String(value) : '';
  return value
    .map((item) => {
      if (item != null && typeof item === 'object') {
        return Object.values(item as Record<string, unknown>)
          .map((v) => (v != null ? String(v) : ''))
          .join(' ');
      }
      return item != null ? String(item) : '';
    })
    .join(' ');
}

interface BaseGridRowData extends JsonlRecord {
  [INTERNAL_ROW_INDEX_FIELD]: number;
  __originalIndex: number;
}

interface DetailRowData {
  __isDetailRow: true;
  __detailKey: string;
  __subtableField: string;
  __subtableData: Record<string, unknown>[];
  __parentOriginalIndex: number;
}

interface FlatDetailRowData {
  __isFlatDetailRow: true;
  __flatDetailKey: string;
  __parentOriginalIndex: number;
  __subtableField: string;
  __subIndex: number;
  [key: string]: unknown;
}

let gridApi: GridApi | null = null;
let allRowData: BaseGridRowData[] = [];
let loadedRowData = new Map<number, BaseGridRowData>();
let currentLargeFileMode = false;
let rowRequestHandler:
  | ((requestId: number, startRow: number, endRow: number) => void)
  | null = null;
let pendingRowRequests = new Map<number, IGetRowsParams>();
let nextRequestId = 1;

let allColumnFields: string[] = [];
let hiddenFieldIds = new Set<string>();
let expandedDetails = new Map<
  string,
  { parentOriginalIndex: number; field: string; data: Record<string, unknown>[] }
>();
let expandedFlats = new Map<
  string,
  { parentOriginalIndex: number; field: string; data: Record<string, unknown>[] }
>();
let detailGridApis = new Map<string, GridApi>();
let subtableFields: string[] = [];
let sourceColumnsForGrid: ColumnDef[] = [];

function applyWrapToNestedGridApi(api: GridApi, minWidth: number): void {
  const w = getCellWrapEnabled();
  api.setGridOption('rowHeight', w ? WRAP_MODE_ROW_HEIGHT_PX : NEST_GRID_ROW_HEIGHT_DEFAULT_PX);
  api.setGridOption('defaultColDef', {
    flex: 1,
    minWidth,
    wrapText: w,
    autoHeight: false,
  });
  const defs = api.getColumnDefs();
  if (defs) {
    api.setGridOption(
      'columnDefs',
      defs.map((d) => ({
        ...d,
        wrapText: w,
        autoHeight: false,
        cellClass: w ? WRAP_CELL_SCROLL_CLASS : undefined,
      }))
    );
  }
  api.resetRowHeights();
}

function buildLineNumberColDef(): ColDef {
  return {
    colId: JSONL_LINE_NUMBER_COL_ID,
    headerName: '#',
    valueGetter: (params) => {
      const d = params.data as Record<string, unknown> | undefined;
      if (!d || d.__isDetailRow || d.__isFlatDetailRow) return '';
      const idx = d[INTERNAL_ROW_INDEX_FIELD];
      return typeof idx === 'number' ? idx + 1 : '';
    },
    width: 52,
    minWidth: 44,
    maxWidth: 96,
    pinned: 'left',
    lockPinned: true,
    lockPosition: 'left',
    sortable: false,
    filter: false,
    resizable: true,
    suppressMovable: true,
    editable: false,
    wrapText: false,
    autoHeight: false,
    cellClass: 'jsonl-line-number-cell jsonl-lead-cell',
    cellRenderer: createLeadColumnCellRenderer({
      showLineNumber: true,
      showResizeGrip: getCellWrapEnabled(),
      getDefaultRowHeightPx: () =>
        getCellWrapEnabled() ? WRAP_MODE_ROW_HEIGHT_PX : DEFAULT_THEME_ROW_HEIGHT_PX,
    }),
    getQuickFilterText: () => '',
  };
}

/** Selection column: custom body only when line numbers are off and Wrap is on (row-height grip). */
function buildMainGridSelectionColumnDef(): SelectionColumnDef | undefined {
  if (getLineNumbersEnabled() || !getCellWrapEnabled()) return undefined;
  return {
    cellRenderer: createSelectionColumnWithGripRenderer({
      getDefaultRowHeightPx: () => WRAP_MODE_ROW_HEIGHT_PX,
    }),
    cellClass: 'jsonl-lead-cell',
    resizable: true,
  };
}

function applyMainGridSelectionColumnDef(): void {
  if (!gridApi) return;
  const def = buildMainGridSelectionColumnDef();
  gridApi.setGridOption('selectionColumnDef', def ?? {});
}

function buildColumnDefsForMainGrid(
  columns: ColumnDef[],
  largeFile: boolean,
  hidden: Set<string>
): ColDef[] {
  const wrap = getCellWrapEnabled();
  const dataCols = columns.map((col) => {
    const isHidden = hidden.has(col.field);
    const def: ColDef = {
      field: col.field,
      headerName: col.headerName,
      sortable: true,
      resizable: true,
      filter: !largeFile,
      minWidth: 60,
      width: col.width,
      hide: isHidden,
    };

    if (col.isSubtable) {
      def.editable = false;
      def.wrapText = false;
      def.autoHeight = !largeFile && wrap;
      def.cellRenderer = (params: {
        value: unknown;
        data: Record<string, unknown>;
        node: { rowIndex: number | null };
        colDef: { field?: string };
      }) => createSubtableCellRenderer(params);
      def.getQuickFilterText = (params: {
        value: unknown;
        data: Record<string, unknown>;
      }) => {
        if (params.data?.__isFlatDetailRow || params.data?.__isDetailRow) return '';
        return flattenArrayToSearchText(params.value);
      };
    } else if (col.type === 'object') {
      def.editable = false;
      def.wrapText = wrap;
      def.autoHeight = false;
      if (wrap) {
        def.cellClass = WRAP_CELL_SCROLL_CLASS;
      }
      def.valueFormatter = (params: { value: unknown }) =>
        params.value != null ? JSON.stringify(params.value) : '';
      def.getQuickFilterText = (params: {
        value: unknown;
        data: Record<string, unknown>;
      }) => {
        if (params.data?.__isFlatDetailRow || params.data?.__isDetailRow) return '';
        return params.value != null ? JSON.stringify(params.value) : '';
      };
    } else {
      def.wrapText = wrap;
      def.autoHeight = false;
      if (wrap) {
        def.cellClass = WRAP_CELL_SCROLL_CLASS;
      }
      def.editable = (params: { data: Record<string, unknown> }) => {
        if (params.data?.__isFlatDetailRow || params.data?.__isDetailRow) return false;
        return true;
      };
      def.getQuickFilterText = (params: {
        value: unknown;
        data: Record<string, unknown>;
      }) => {
        if (params.data?.__isFlatDetailRow || params.data?.__isDetailRow) return '';
        return params.value != null ? String(params.value) : '';
      };
      if (col.type === 'number') {
        def.filter = 'agNumberColumnFilter';
        def.valueParser = (params: { newValue: string }) => {
          const value = Number(params.newValue);
          return Number.isNaN(value) ? params.newValue : value;
        };
      }
    }

    return def;
  });
  if (getLineNumbersEnabled()) {
    return [buildLineNumberColDef(), ...dataCols];
  }
  return dataCols;
}

let onDetailModeSwitch:
  | ((
      targetMode: string,
      rowIndex: number,
      field: string,
      data: Record<string, unknown>[]
    ) => void)
  | null = null;

export function setDetailSwitchHandler(
  handler: (
    targetMode: string,
    rowIndex: number,
    field: string,
    data: Record<string, unknown>[]
  ) => void
): void {
  onDetailModeSwitch = handler;
}

export function getGridApi(): GridApi | null {
  return gridApi;
}

class DetailRenderer {
  private eGui!: HTMLElement;
  private subGridApi: GridApi | null = null;
  private detailKey = '';

  init(params: { data: DetailRowData }) {
    const data = params.data;
    this.detailKey = data.__detailKey;

    this.eGui = document.createElement('div');
    this.eGui.className = 'subtable-inline-detail';

    const header = document.createElement('div');
    header.className = 'subtable-inline-header';

    const title = document.createElement('strong');
    title.textContent = data.__subtableField;
    title.style.fontSize = '12px';

    const controls = document.createElement('div');
    controls.style.display = 'flex';
    controls.style.gap = '4px';
    controls.style.alignItems = 'center';

    const autoSizeBtn = document.createElement('button');
    autoSizeBtn.className = 'subtable-expand-btn';
    autoSizeBtn.textContent = '\u2194';
    autoSizeBtn.title = '\u5217\u5E45\u3092\u81EA\u52D5\u8ABF\u6574';
    autoSizeBtn.addEventListener('click', () => {
      if (!this.subGridApi) return;
      this.subGridApi.autoSizeAllColumns();
      clampAutosizedColumnWidths(this.subGridApi);
    });

    const switchBtn = document.createElement('button');
    switchBtn.className = 'subtable-expand-btn';
    switchBtn.textContent = '\u2B06';
    switchBtn.title = '\u30D5\u30E9\u30C3\u30C8\u30E2\u30FC\u30C9\u306B\u5207\u66FF';
    switchBtn.addEventListener('click', () => {
      if (onDetailModeSwitch) {
        onDetailModeSwitch(
          'flat',
          data.__parentOriginalIndex,
          data.__subtableField,
          data.__subtableData
        );
      }
    });

    const collapseBtn = document.createElement('button');
    collapseBtn.className = 'subtable-expand-btn';
    collapseBtn.textContent = '\u25BC';
    collapseBtn.title = '\u6298\u308A\u305F\u305F\u3080';
    collapseBtn.addEventListener('click', () => {
      toggleInlineDetail(
        data.__parentOriginalIndex,
        data.__subtableField,
        data.__subtableData
      );
    });

    controls.appendChild(autoSizeBtn);
    controls.appendChild(switchBtn);
    controls.appendChild(collapseBtn);

    header.appendChild(title);
    header.appendChild(controls);
    this.eGui.appendChild(header);

    const gridDiv = document.createElement('div');
    gridDiv.className = 'subtable-inline-grid';

    const container = document.getElementById('grid-container');
    if (container?.classList.contains('ag-theme-alpine-dark')) {
      gridDiv.classList.add('ag-theme-alpine-dark');
    } else {
      gridDiv.classList.add('ag-theme-alpine');
    }
    this.eGui.appendChild(gridDiv);

    const allKeys = new Set<string>();
    for (const row of data.__subtableData) {
      for (const key of Object.keys(row)) {
        allKeys.add(key);
      }
    }

    const nestWrap = getCellWrapEnabled();
    const colDefs: ColDef[] = [...allKeys].map((key) => ({
      field: key,
      headerName: key,
      resizable: true,
      sortable: true,
      minWidth: 60,
      wrapText: nestWrap,
      autoHeight: false,
      cellClass: nestWrap ? WRAP_CELL_SCROLL_CLASS : undefined,
    }));

    const gridOptions: GridOptions = {
      columnDefs: colDefs,
      rowData: [...data.__subtableData],
      domLayout: 'normal',
      headerHeight: 28,
      rowHeight: nestWrap ? WRAP_MODE_ROW_HEIGHT_PX : NEST_GRID_ROW_HEIGHT_DEFAULT_PX,
      defaultColDef: {
        flex: 1,
        minWidth: 60,
        wrapText: nestWrap,
        autoHeight: false,
      },
      getMainMenuItems: getMainMenuItemsWithSetColumnWidth,
      autoSizeStrategy: {
        type: 'fitCellContents',
      },
      onFirstDataRendered: (e) => {
        clampAutosizedColumnWidths(e.api);
      },
    };

    this.subGridApi = createGrid(gridDiv, gridOptions);
    detailGridApis.set(this.detailKey, this.subGridApi);
  }

  getGui() {
    return this.eGui;
  }

  destroy() {
    if (this.subGridApi) {
      detailGridApis.delete(this.detailKey);
      this.subGridApi.destroy();
      this.subGridApi = null;
    }
  }
}

function refreshDisplayData(): void {
  if (!gridApi || currentLargeFileMode) return;

  const display: unknown[] = [];
  for (let i = 0; i < allRowData.length; i++) {
    const baseRow = allRowData[i];
    display.push(baseRow);

    for (const [, detail] of expandedDetails) {
      if (detail.parentOriginalIndex === i) {
        display.push({
          __isDetailRow: true,
          __detailKey: `${i}:${detail.field}`,
          __subtableField: detail.field,
          __subtableData: detail.data,
          __parentOriginalIndex: i,
        } as DetailRowData);
      }
    }

    for (const [, flat] of expandedFlats) {
      if (flat.parentOriginalIndex === i) {
        for (let subIndex = 0; subIndex < flat.data.length; subIndex++) {
          const subRecord = flat.data[subIndex];
          const summary = Object.entries(subRecord)
            .map(([key, value]) => `${key}: ${value != null ? String(value) : ''}`)
            .join(', ');
          display.push({
            __isFlatDetailRow: true,
            __flatDetailKey: `${i}:${flat.field}:${subIndex}`,
            __parentOriginalIndex: i,
            __subtableField: flat.field,
            __subIndex: subIndex,
            ...subRecord,
            [flat.field]: summary,
          } as FlatDetailRowData);
        }
      }
    }
  }

  gridApi.setGridOption('rowData', display);
}

function buildAnnotatedRows(
  records: JsonlRecord[],
  startIndex: number
): BaseGridRowData[] {
  return records.map((record, offset) => ({
    ...(record as Record<string, unknown>),
    [INTERNAL_ROW_INDEX_FIELD]: startIndex + offset,
    __originalIndex: startIndex + offset,
  })) as BaseGridRowData[];
}

function createInfiniteDatasource(): IDatasource {
  return {
    getRows: (params: IGetRowsParams) => {
      if (!rowRequestHandler) {
        params.failCallback();
        return;
      }
      const requestId = nextRequestId++;
      pendingRowRequests.set(requestId, params);
      rowRequestHandler(requestId, params.startRow, params.endRow);
    },
  };
}

export function initGrid(
  container: HTMLElement,
  columns: ColumnDef[],
  onCellEdit: (edit: CellEdit) => void,
  options?: {
    initialHiddenFields?: string[];
    initialCellWrap?: boolean;
    initialShowLineNumbers?: boolean;
    largeFileMode?: boolean;
    onRequestRows?: (
      requestId: number,
      startRow: number,
      endRow: number
    ) => void;
  }
): GridApi {
  currentLargeFileMode = options?.largeFileMode === true;
  rowRequestHandler = options?.onRequestRows ?? null;
  pendingRowRequests.clear();
  nextRequestId = 1;
  loadedRowData.clear();

  setCellWrapEnabledPreference(options?.initialCellWrap !== false);
  setLineNumbersVisiblePreference(options?.initialShowLineNumbers !== false);

  sourceColumnsForGrid = columns;
  subtableFields = columns.filter((col) => col.isSubtable).map((col) => col.field);
  allColumnFields = columns.map((col) => col.field);
  hiddenFieldIds = new Set(options?.initialHiddenFields ?? []);

  const wrap = getCellWrapEnabled();
  const colDefs = buildColumnDefsForMainGrid(columns, currentLargeFileMode, hiddenFieldIds);
  const selectionColumnDef = buildMainGridSelectionColumnDef();

  const gridOptions: GridOptions = {
    columnDefs: colDefs,
    rowData: currentLargeFileMode ? undefined : [],
    rowModelType: currentLargeFileMode ? 'infinite' : 'clientSide',
    cacheBlockSize: currentLargeFileMode ? LARGE_FILE_BLOCK_SIZE : undefined,
    maxBlocksInCache: currentLargeFileMode ? 6 : undefined,
    blockLoadDebounceMillis: currentLargeFileMode ? 75 : undefined,
    defaultColDef: {
      sortable: true,
      resizable: true,
      filter: !currentLargeFileMode,
      minWidth: 60,
      wrapText: wrap,
      autoHeight: false,
    },
    getMainMenuItems: getMainMenuItemsWithSetColumnWidth,
    rowSelection: { mode: 'multiRow' },
    ...(selectionColumnDef != null ? { selectionColumnDef } : {}),
    enableCellTextSelection: true,
    suppressRowClickSelection: true,
    animateRows: false,
    autoSizeStrategy: currentLargeFileMode
      ? undefined
      : {
          type: 'fitCellContents',
        },
    isFullWidthRow: (params) => {
      if (currentLargeFileMode) return false;
      return params.rowNode.data?.__isDetailRow === true;
    },
    fullWidthCellRenderer: currentLargeFileMode ? undefined : DetailRenderer,
    getRowHeight: (params) =>
      resolveRowHeightForGrid({
        data: params.data as Record<string, unknown> | undefined,
        largeFileMode: currentLargeFileMode,
        cellWrapEnabled: getCellWrapEnabled(),
      }),
    getRowStyle: (params) => {
      if (!getCellWrapEnabled()) return undefined;
      const d = params.data as Record<string, unknown> | undefined;
      if (!d || d.__isDetailRow === true) return undefined;
      const rh = params.node.rowHeight;
      if (typeof rh !== 'number' || rh <= 0) return undefined;
      return {
        [WRAP_CELL_VALUE_MAX_HEIGHT_CSS_VAR]: `${wrapScrollCellValueMaxHeightPx(rh)}px`,
      };
    },
    onCellValueChanged: (event: CellValueChangedEvent) => {
      if (event.data?.__isDetailRow || event.data?.__isFlatDetailRow) return;
      if (event.colDef.colId === JSONL_LINE_NUMBER_COL_ID) return;
      const rowIndex = event.data?.[INTERNAL_ROW_INDEX_FIELD];
      if (typeof rowIndex === 'number' && event.colDef.field) {
        onCellEdit({
          rowIndex,
          field: event.colDef.field,
          oldValue: event.oldValue,
          newValue: event.newValue,
        });
      }
    },
    getRowId: (params) => {
      if (params.data?.__isDetailRow) {
        return `detail-${(params.data as DetailRowData).__detailKey}`;
      }
      if (params.data?.__isFlatDetailRow) {
        return `flat-${(params.data as FlatDetailRowData).__flatDetailKey}`;
      }
      const rowIndex = params.data?.[INTERNAL_ROW_INDEX_FIELD];
      return typeof rowIndex === 'number' ? String(rowIndex) : String(params.data.__rowIndex ?? 0);
    },
    rowClassRules: {
      'flat-detail-row': (params: { data: Record<string, unknown> }) =>
        params.data?.__isFlatDetailRow === true,
    },
    onFirstDataRendered: (e) => {
      if (!currentLargeFileMode) {
        clampAutosizedColumnWidths(e.api);
      }
    },
  };

  gridApi = createGrid(container, gridOptions);
  if (currentLargeFileMode) {
    gridApi.setGridOption('datasource', createInfiniteDatasource());
  }
  return gridApi;
}

export function resolveRowsRequest(
  requestId: number,
  rows: JsonlRecord[],
  lastRow: number
): void {
  const params = pendingRowRequests.get(requestId);
  if (!params) return;
  pendingRowRequests.delete(requestId);

  const annotatedRows = buildAnnotatedRows(rows, params.startRow);
  for (const row of annotatedRows) {
    loadedRowData.set(row[INTERNAL_ROW_INDEX_FIELD], row);
  }
  params.successCallback(annotatedRows, lastRow);
}

export function setRowData(records: JsonlRecord[], startIndex: number): void {
  if (!gridApi || currentLargeFileMode) return;

  const annotatedRows = buildAnnotatedRows(records, startIndex);
  for (let i = 0; i < annotatedRows.length; i++) {
    const globalIndex = startIndex + i;
    allRowData[globalIndex] = annotatedRows[i];
    loadedRowData.set(globalIndex, annotatedRows[i]);
  }

  refreshDisplayData();

  if (startIndex === 0) {
    gridApi.autoSizeAllColumns();
    clampAutosizedColumnWidths(gridApi);
  }
}

export function applyGridEdit(edit: CellEdit): void {
  if (!gridApi) return;

  if (currentLargeFileMode) {
    const row = loadedRowData.get(edit.rowIndex);
    if (row) {
      row[edit.field] = edit.newValue;
      const rowNode = gridApi.getRowNode(String(edit.rowIndex));
      rowNode?.setDataValue(edit.field, edit.newValue);
    }
    return;
  }

  const row = allRowData[edit.rowIndex];
  if (!row) return;
  row[edit.field] = edit.newValue;
  loadedRowData.set(edit.rowIndex, row);
  refreshDisplayData();
}

export function focusMatch(match: SearchMatch): void {
  if (!gridApi) return;

  const reveal = () => {
    gridApi?.ensureIndexVisible(match.rowIndex, 'middle');
    gridApi?.ensureColumnVisible(match.colId);
  };

  reveal();
  if (currentLargeFileMode) {
    setTimeout(reveal, 60);
  }
}

export function setLineNumbersVisible(visible: boolean): void {
  setLineNumbersVisiblePreference(visible);
  if (!gridApi || sourceColumnsForGrid.length === 0) return;
  gridApi.setGridOption(
    'columnDefs',
    buildColumnDefsForMainGrid(sourceColumnsForGrid, currentLargeFileMode, hiddenFieldIds)
  );
  applyMainGridSelectionColumnDef();
  if (!currentLargeFileMode) {
    gridApi.autoSizeAllColumns();
    clampAutosizedColumnWidths(gridApi);
  }
}

export function setCellWrapEnabled(enabled: boolean): void {
  setCellWrapEnabledPreference(enabled);
  if (!enabled) {
    clearCustomRowHeights();
  }
  if (!gridApi || sourceColumnsForGrid.length === 0) return;
  gridApi.setGridOption('defaultColDef', {
    sortable: true,
    resizable: true,
    filter: !currentLargeFileMode,
    minWidth: 60,
    wrapText: enabled,
    autoHeight: false,
  });
  gridApi.setGridOption(
    'columnDefs',
    buildColumnDefsForMainGrid(sourceColumnsForGrid, currentLargeFileMode, hiddenFieldIds)
  );
  applyMainGridSelectionColumnDef();
  gridApi.resetRowHeights();
  for (const api of detailGridApis.values()) {
    applyWrapToNestedGridApi(api, 60);
  }
  refreshActivePanelCellWrap();
  if (!currentLargeFileMode) {
    gridApi.autoSizeAllColumns();
    clampAutosizedColumnWidths(gridApi);
    for (const api of detailGridApis.values()) {
      api.autoSizeAllColumns();
      clampAutosizedColumnWidths(api);
    }
    autoSizeClampActiveSubtablePanel();
  }
}

export function destroyGrid(): void {
  if (gridApi) {
    gridApi.destroy();
    gridApi = null;
  }
  clearCustomRowHeights();
  sourceColumnsForGrid = [];
  pendingRowRequests.clear();
  rowRequestHandler = null;
}

export function resetData(): void {
  for (const [, api] of detailGridApis) {
    api.destroy();
  }
  detailGridApis.clear();
  expandedDetails.clear();
  expandedFlats.clear();
  allRowData = [];
  loadedRowData.clear();
  pendingRowRequests.clear();
}

export function updateInfoBar(
  totalRows: number,
  totalCols: number,
  visibleCols?: number
): void {
  const rowCountEl = document.getElementById('row-count');
  const colCountEl = document.getElementById('col-count');
  if (rowCountEl) rowCountEl.textContent = `Rows: ${totalRows}`;
  if (colCountEl) {
    if (visibleCols !== undefined && visibleCols < totalCols) {
      colCountEl.textContent = `Cols: ${visibleCols} / ${totalCols}`;
    } else {
      colCountEl.textContent = `Cols: ${totalCols}`;
    }
  }
}

export function setColumnVisibility(field: string, visible: boolean): void {
  if (!gridApi) return;
  if (visible) {
    hiddenFieldIds.delete(field);
    gridApi.setColumnsVisible([field], true);
  } else {
    hiddenFieldIds.add(field);
    gridApi.setColumnsVisible([field], false);
  }
}

export function setAllColumnsVisible(): void {
  if (!gridApi || allColumnFields.length === 0) return;
  hiddenFieldIds.clear();
  gridApi.setColumnsVisible(allColumnFields, true);
}

export function setAllColumnsHidden(): void {
  if (!gridApi || allColumnFields.length === 0) return;
  for (const field of allColumnFields) {
    hiddenFieldIds.add(field);
  }
  gridApi.setColumnsVisible(allColumnFields, false);
}

export function resetColumnVisibility(): void {
  setAllColumnsVisible();
}

export function getVisibleColumnFields(): string[] {
  return allColumnFields.filter((field) => !hiddenFieldIds.has(field));
}

export function getAllColumnFields(): string[] {
  return [...allColumnFields];
}

export function isColumnVisible(field: string): boolean {
  return !hiddenFieldIds.has(field);
}

export function toggleInlineDetail(
  parentOriginalIndex: number,
  field: string,
  data: Record<string, unknown>[]
): void {
  if (currentLargeFileMode) return;

  const key = `${parentOriginalIndex}:${field}`;
  if (expandedDetails.has(key)) {
    expandedDetails.delete(key);
    const api = detailGridApis.get(key);
    if (api) {
      api.destroy();
      detailGridApis.delete(key);
    }
  } else {
    if (expandedFlats.has(key)) {
      expandedFlats.delete(key);
    }
    expandedDetails.set(key, { parentOriginalIndex, field, data });
  }
  refreshDisplayData();
}

export function toggleFlatDetail(
  parentOriginalIndex: number,
  field: string,
  data: Record<string, unknown>[]
): void {
  if (currentLargeFileMode) return;

  const key = `${parentOriginalIndex}:${field}`;
  if (expandedFlats.has(key)) {
    expandedFlats.delete(key);
  } else {
    if (expandedDetails.has(key)) {
      expandedDetails.delete(key);
      const api = detailGridApis.get(key);
      if (api) {
        api.destroy();
        detailGridApis.delete(key);
      }
    }
    expandedFlats.set(key, { parentOriginalIndex, field, data });
  }
  refreshDisplayData();
}

export function getSubtableData(
  parentOriginalIndex: number,
  field: string
): Record<string, unknown>[] | null {
  if (currentLargeFileMode) {
    const row = loadedRowData.get(parentOriginalIndex);
    if (!row) return null;
    const value = row[field];
    return Array.isArray(value) ? (value as Record<string, unknown>[]) : null;
  }

  const row = allRowData[parentOriginalIndex];
  if (!row) return null;
  const value = row[field];
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : null;
}

export function toggleInlineExpandAll(): boolean {
  if (currentLargeFileMode || subtableFields.length === 0) return false;

  if (expandedDetails.size > 0) {
    for (const [, api] of detailGridApis) {
      api.destroy();
    }
    detailGridApis.clear();
    expandedDetails.clear();
    refreshDisplayData();
    return false;
  }

  expandedFlats.clear();

  for (let i = 0; i < allRowData.length; i++) {
    const row = allRowData[i] as Record<string, unknown>;
    for (const field of subtableFields) {
      const value = row[field];
      if (Array.isArray(value) && value.length > 0) {
        expandedDetails.set(`${i}:${field}`, {
          parentOriginalIndex: i,
          field,
          data: value as Record<string, unknown>[],
        });
      }
    }
  }

  refreshDisplayData();
  return true;
}

export function toggleFlatExpandAll(): boolean {
  if (currentLargeFileMode || subtableFields.length === 0) return false;

  if (expandedFlats.size > 0) {
    expandedFlats.clear();
    refreshDisplayData();
    if (gridApi) {
      gridApi.autoSizeAllColumns();
      clampAutosizedColumnWidths(gridApi);
    }
    return false;
  }

  for (const [key] of expandedDetails) {
    const api = detailGridApis.get(key);
    if (api) api.destroy();
  }
  expandedDetails.clear();
  detailGridApis.clear();

  for (let i = 0; i < allRowData.length; i++) {
    const row = allRowData[i] as Record<string, unknown>;
    for (const field of subtableFields) {
      const value = row[field];
      if (Array.isArray(value) && value.length > 0) {
        expandedFlats.set(`${i}:${field}`, {
          parentOriginalIndex: i,
          field,
          data: value as Record<string, unknown>[],
        });
      }
    }
  }

  refreshDisplayData();
  widenSubtableColumns();
  return true;
}

function widenSubtableColumns(): void {
  if (!gridApi) return;
  const widths = subtableFields.map((field) => ({ key: field, newWidth: 360 }));
  gridApi.setColumnWidths(widths);
}
