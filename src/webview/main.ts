import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';

import type {
  ExtToWebviewMessage,
  WebviewToExtMessage,
  CellEdit,
  ColumnDef,
  GridStats,
} from '../types';
import { getCellWrapEnabled } from './cellWrapPreference';
import { getLineNumbersEnabled } from './lineNumberPreference';
import {
  initGrid,
  setRowData,
  resetData,
  updateInfoBar,
  toggleInlineDetail,
  toggleFlatDetail,
  getSubtableData,
  toggleInlineExpandAll,
  toggleFlatExpandAll,
  setDetailSwitchHandler,
  resolveRowsRequest,
  applyGridEdit,
  focusMatch,
  destroyGrid,
  getVisibleColumnFields,
  setColumnVisibility,
  setAllColumnsVisible,
  setAllColumnsHidden,
  resetColumnVisibility,
  isColumnVisible,
  setCellWrapEnabled,
  setLineNumbersVisible,
} from './grid';
import { applyTheme, observeThemeChanges } from './theme';
import { SearchController } from './search';
import {
  setSubtableEditHandler,
  closeSubtablePanel,
  setInlineToggleHandler,
  setFlatToggleHandler,
  setFlatModeSwitchHandler,
  switchAndOpen,
  setAllowedPanelModes,
} from './subtableRenderer';

declare function acquireVsCodeApi(): {
  postMessage(message: WebviewToExtMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();
const gridContainer = document.getElementById('grid-container')!;

type WebviewUiState = { cellWrap?: boolean; showLineNumbers?: boolean };

function readWebviewUiState(): WebviewUiState {
  const s = vscode.getState();
  if (s != null && typeof s === 'object' && !Array.isArray(s)) {
    return s as WebviewUiState;
  }
  return {};
}

function writeWebviewUiState(partial: WebviewUiState): void {
  vscode.setState({ ...readWebviewUiState(), ...partial });
}

function syncGridWrapCheckbox(checked: boolean): void {
  const el = document.getElementById('grid-wrap-text') as HTMLInputElement | null;
  if (el) el.checked = checked;
}

function syncGridLineNumbersCheckbox(checked: boolean): void {
  const el = document.getElementById('grid-show-line-numbers') as HTMLInputElement | null;
  if (el) el.checked = checked;
}

function hasSubtableColumns(): boolean {
  return columns.some((c) => c.isSubtable);
}

const NORMAL_CHUNK_SIZE = 500;

let searchController: SearchController;
let totalRows = 0;
let columns: ColumnDef[] = [];
let largeFileMode = false;
let currentStats: GridStats | null = null;

applyTheme(gridContainer);
observeThemeChanges(gridContainer);

searchController = new SearchController(
  (query) => {
    vscode.postMessage({ type: 'search-query', query });
  },
  (direction) => {
    vscode.postMessage({ type: 'search-step', direction });
  }
);

const gridMenuInlineAll = document.getElementById(
  'grid-menu-inline-all'
) as HTMLButtonElement | null;
const gridMenuFlatAll = document.getElementById(
  'grid-menu-flat-all'
) as HTMLButtonElement | null;

if (gridMenuInlineAll) {
  gridMenuInlineAll.addEventListener('click', () => {
    if (gridMenuInlineAll.disabled) return;
    const expanded = toggleInlineExpandAll();
    gridMenuInlineAll.textContent = expanded ? 'Collapse All' : 'Inline All';
    gridMenuInlineAll.title = expanded
      ? 'Collapse all inline expansions'
      : 'Expand all subtables inline';
    if (gridMenuFlatAll) {
      gridMenuFlatAll.textContent = 'Flat All';
      gridMenuFlatAll.title = 'Expand all subtables flat';
    }
  });
}

if (gridMenuFlatAll) {
  gridMenuFlatAll.addEventListener('click', () => {
    if (gridMenuFlatAll.disabled) return;
    const expanded = toggleFlatExpandAll();
    gridMenuFlatAll.textContent = expanded ? 'Collapse All' : 'Flat All';
    gridMenuFlatAll.title = expanded
      ? 'Collapse all flat expansions'
      : 'Expand all subtables flat';
    if (gridMenuInlineAll) {
      gridMenuInlineAll.textContent = 'Inline All';
      gridMenuInlineAll.title = 'Expand all subtables inline';
    }
  });
}

setInlineToggleHandler(toggleInlineDetail);
setFlatToggleHandler(toggleFlatDetail);

setFlatModeSwitchHandler((parentIndex, field, targetMode) => {
  toggleFlatDetail(parentIndex, field, []);
  const data = getSubtableData(parentIndex, field);
  if (data) {
    switchAndOpen(targetMode as 'modal' | 'docked', parentIndex, field, data);
  }
});

setDetailSwitchHandler((targetMode, rowIndex, field, data) => {
  toggleInlineDetail(rowIndex, field, data);
  if (targetMode === 'flat') {
    toggleFlatDetail(rowIndex, field, data);
  } else {
    switchAndOpen(targetMode as 'modal' | 'docked', rowIndex, field, data);
  }
});

setSubtableEditHandler((rowIndex, field, subIndex, subField, oldValue, newValue) => {
  vscode.postMessage({
    type: 'cell-edit',
    edit: {
      rowIndex,
      field: `${field}[${subIndex}].${subField}`,
      oldValue,
      newValue,
    },
  });
});

function refreshInfoBar(): void {
  updateInfoBar(totalRows, columns.length, getVisibleColumnFields().length);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function updateModeIndicator(): void {
  const indicator = document.getElementById('mode-indicator');
  if (!indicator) return;

  if (!largeFileMode || !currentStats) {
    indicator.setAttribute('hidden', 'true');
    indicator.textContent = '';
    indicator.removeAttribute('title');
    return;
  }

  indicator.removeAttribute('hidden');
  indicator.textContent = 'Large file mode';
  indicator.setAttribute(
    'title',
    `${formatBytes(currentStats.fileSizeBytes)} / ${currentStats.totalRows} rows / ${currentStats.totalColumns} cols. Inline/Flat bulk expansion is disabled.`
  );
}

function updateGridMenuBulkActions(): void {
  const largeFileTitle =
    'Disabled in large file mode to keep scrolling and rendering responsive';
  const noSubtableTitle = 'No subtable columns in this file';
  const hasSub = hasSubtableColumns();
  const canUse = !largeFileMode && hasSub;

  if (gridMenuInlineAll) {
    gridMenuInlineAll.textContent = 'Inline All';
    gridMenuInlineAll.disabled = !canUse;
    gridMenuInlineAll.title = largeFileMode
      ? largeFileTitle
      : !hasSub
        ? noSubtableTitle
        : 'Expand all subtables inline';
  }

  if (gridMenuFlatAll) {
    gridMenuFlatAll.textContent = 'Flat All';
    gridMenuFlatAll.disabled = !canUse;
    gridMenuFlatAll.title = largeFileMode
      ? largeFileTitle
      : !hasSub
        ? noSubtableTitle
        : 'Expand all subtables flat';
  }
}

function requestClientChunk(startRow: number): void {
  const endRow = Math.min(startRow + NORMAL_CHUNK_SIZE, totalRows);
  if (startRow >= endRow) return;
  vscode.postMessage({
    type: 'request-rows',
    requestId: 0,
    startRow,
    endRow,
  });
}

function buildColumnPickerContent(): void {
  const dropdown = document.getElementById('column-picker-dropdown');
  if (!dropdown) return;
  dropdown.innerHTML = '';

  const list = document.createElement('div');
  list.className = 'column-picker-list';
  for (const col of columns) {
    const label = document.createElement('label');
    label.className = 'column-picker-item';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = isColumnVisible(col.field);
    cb.dataset.field = col.field;
    cb.addEventListener('change', () => {
      setColumnVisibility(col.field, cb.checked);
      refreshInfoBar();
    });
    label.appendChild(cb);
    const span = document.createElement('span');
    span.textContent = col.headerName || col.field;
    span.className = 'column-picker-label';
    label.appendChild(span);
    list.appendChild(label);
  }
  dropdown.appendChild(list);

  const actions = document.createElement('div');
  actions.className = 'column-picker-actions';
  const clearSelectionBtn = document.createElement('button');
  clearSelectionBtn.type = 'button';
  clearSelectionBtn.textContent = 'Clear selection';
  clearSelectionBtn.className = 'column-picker-action-btn';
  clearSelectionBtn.title =
    'Uncheck all columns so you can select only the ones to show';
  clearSelectionBtn.addEventListener('click', () => {
    setAllColumnsHidden();
    refreshInfoBar();
    buildColumnPickerContent();
  });
  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.textContent = 'Reset';
  resetBtn.className = 'column-picker-action-btn';
  resetBtn.title = 'Show all columns again';
  resetBtn.addEventListener('click', () => {
    resetColumnVisibility();
    refreshInfoBar();
    buildColumnPickerContent();
  });
  actions.appendChild(clearSelectionBtn);
  actions.appendChild(resetBtn);
  dropdown.appendChild(actions);
}

function closeColumnPicker(): void {
  const dropdown = document.getElementById('column-picker-dropdown');
  if (dropdown) {
    dropdown.classList.remove('column-picker-open');
    dropdown.setAttribute('aria-hidden', 'true');
  }
}

function toggleColumnPicker(): void {
  const dropdown = document.getElementById('column-picker-dropdown');
  const btn = document.getElementById('column-picker-btn');
  if (!dropdown || !btn) return;
  const isOpen = dropdown.classList.contains('column-picker-open');
  if (isOpen) {
    closeColumnPicker();
    return;
  }
  if (columns.length > 0) {
    buildColumnPickerContent();
  }
  dropdown.classList.add('column-picker-open');
  dropdown.setAttribute('aria-hidden', 'false');
  setTimeout(() => {
    const onOutside = (e: MouseEvent) => {
      const wrap = document.getElementById('column-picker-wrap');
      if (wrap && !wrap.contains(e.target as Node)) {
        closeColumnPicker();
        document.removeEventListener('click', onOutside);
      }
    };
    document.addEventListener('click', onOutside);
  }, 0);
}

const columnPickerBtn = document.getElementById('column-picker-btn');
if (columnPickerBtn) {
  columnPickerBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleColumnPicker();
  });
}

function closeGridMenu(): void {
  const dropdown = document.getElementById('grid-menu-dropdown');
  if (dropdown) {
    dropdown.classList.remove('grid-menu-open');
    dropdown.setAttribute('aria-hidden', 'true');
  }
}

function toggleGridMenu(): void {
  const dropdown = document.getElementById('grid-menu-dropdown');
  const btn = document.getElementById('grid-menu-btn');
  if (!dropdown || !btn) return;
  const isOpen = dropdown.classList.contains('grid-menu-open');
  if (isOpen) {
    closeGridMenu();
    return;
  }
  syncGridWrapCheckbox(getCellWrapEnabled());
  syncGridLineNumbersCheckbox(getLineNumbersEnabled());
  dropdown.classList.add('grid-menu-open');
  dropdown.setAttribute('aria-hidden', 'false');
  setTimeout(() => {
    const onOutside = (e: MouseEvent) => {
      const wrap = document.getElementById('grid-menu-wrap');
      if (wrap && !wrap.contains(e.target as Node)) {
        closeGridMenu();
        document.removeEventListener('click', onOutside);
      }
    };
    document.addEventListener('click', onOutside);
  }, 0);
}

const gridMenuBtn = document.getElementById('grid-menu-btn');
if (gridMenuBtn) {
  gridMenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleGridMenu();
  });
}

const gridWrapText = document.getElementById('grid-wrap-text') as HTMLInputElement | null;
if (gridWrapText) {
  gridWrapText.addEventListener('change', () => {
    const enabled = gridWrapText.checked;
    writeWebviewUiState({ cellWrap: enabled });
    setCellWrapEnabled(enabled);
  });
}

const gridShowLineNumbers = document.getElementById(
  'grid-show-line-numbers'
) as HTMLInputElement | null;
if (gridShowLineNumbers) {
  gridShowLineNumbers.addEventListener('change', () => {
    const visible = gridShowLineNumbers.checked;
    writeWebviewUiState({ showLineNumbers: visible });
    setLineNumbersVisible(visible);
  });
}

function recreateGrid(): void {
  destroyGrid();
  resetData();
  closeSubtablePanel();
  gridContainer.innerHTML = '';

  const ui = readWebviewUiState();
  const initialCellWrap = ui.cellWrap !== false;
  const initialShowLineNumbers = ui.showLineNumbers !== false;

  const api = initGrid(
    gridContainer,
    columns,
    (edit: CellEdit) => {
      vscode.postMessage({ type: 'cell-edit', edit });
    },
    {
      initialHiddenFields: [],
      initialCellWrap,
      initialShowLineNumbers,
      largeFileMode,
      onRequestRows: (requestId, startRow, endRow) => {
        vscode.postMessage({
          type: 'request-rows',
          requestId,
          startRow,
          endRow,
        });
      },
    }
  );
  syncGridWrapCheckbox(initialCellWrap);
  syncGridLineNumbersCheckbox(initialShowLineNumbers);
  searchController.setGridApi(api);
  searchController.setLargeFileMode(largeFileMode);
  setAllowedPanelModes({
    allowInline: !largeFileMode,
    allowFlat: !largeFileMode,
  });

  if (!largeFileMode) {
    requestClientChunk(0);
  }
}

window.addEventListener('message', (event) => {
  const message = event.data as ExtToWebviewMessage;

  switch (message.type) {
    case 'init': {
      columns = message.columns;
      totalRows = message.totalRows;
      largeFileMode = message.largeFileMode;
      currentStats = message.stats;

      recreateGrid();
      updateModeIndicator();
      updateGridMenuBulkActions();
      refreshInfoBar();
      break;
    }

    case 'rows-range': {
      if (largeFileMode) {
        resolveRowsRequest(message.requestId, message.rows, message.lastRow);
      } else {
        setRowData(message.rows, message.startRow);
        const nextStart = message.endRow;
        if (nextStart < totalRows) {
          requestClientChunk(nextStart);
        }
      }
      break;
    }

    case 'apply-edit': {
      applyGridEdit(message.edit);
      break;
    }

    case 'search-result': {
      searchController.applyRemoteResult(message.result);
      break;
    }

    case 'focus-match': {
      focusMatch(message.match);
      break;
    }

    case 'theme-changed': {
      applyTheme(gridContainer);
      break;
    }
  }
});

vscode.postMessage({ type: 'ready' });
