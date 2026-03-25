import { createGrid, type GridApi, type GridOptions, type ColDef } from 'ag-grid-community';
import { getCellWrapEnabled } from './cellWrapPreference';
import { getMainMenuItemsWithSetColumnWidth } from './columnMenuWidth';
import { clampAutosizedColumnWidths } from './columnWidthLimits';
import {
  SUBTABLE_PANEL_ROW_HEIGHT_DEFAULT_PX,
  WRAP_CELL_SCROLL_CLASS,
  WRAP_MODE_ROW_HEIGHT_PX,
} from './wrapCellLayout';

interface SubtableRecord {
  [key: string]: unknown;
}

type PanelMode = 'modal' | 'docked' | 'inline' | 'flat';

let allowedModes: PanelMode[] = ['modal', 'docked', 'inline', 'flat'];
let currentMode: PanelMode = normalizeMode(
  (localStorage.getItem('subtable-panel-mode') as PanelMode) || 'modal'
);
let activeOverlay: HTMLElement | null = null;
let activeDockedContainer: HTMLElement | null = null;
let activePanelApi: GridApi | null = null;
let activeKey: string | null = null;
let escHandler: ((e: KeyboardEvent) => void) | null = null;
let onSubtableEdit: ((
  rowIndex: number,
  field: string,
  subIndex: number,
  subField: string,
  oldValue: unknown,
  newValue: unknown
) => void) | null = null;

// Callback for inline detail toggle (provided by grid.ts via main.ts)
let onInlineToggle: ((
  rowIndex: number,
  field: string,
  data: SubtableRecord[]
) => void) | null = null;

export function setSubtableEditHandler(
  handler: (
    rowIndex: number,
    field: string,
    subIndex: number,
    subField: string,
    oldValue: unknown,
    newValue: unknown
  ) => void
): void {
  onSubtableEdit = handler;
}

export function setInlineToggleHandler(
  handler: (rowIndex: number, field: string, data: SubtableRecord[]) => void
): void {
  onInlineToggle = handler;
}

export function setAllowedPanelModes(options: {
  allowInline: boolean;
  allowFlat: boolean;
}): void {
  allowedModes = ['modal', 'docked'];
  if (options.allowInline) {
    allowedModes.push('inline');
  }
  if (options.allowFlat) {
    allowedModes.push('flat');
  }
  currentMode = normalizeMode(currentMode);
  localStorage.setItem('subtable-panel-mode', currentMode);
}

// Callback for flat detail toggle (provided by grid.ts via main.ts)
let onFlatToggle: ((
  rowIndex: number,
  field: string,
  data: SubtableRecord[]
) => void) | null = null;

export function setFlatToggleHandler(
  handler: (rowIndex: number, field: string, data: SubtableRecord[]) => void
): void {
  onFlatToggle = handler;
}

// Callback for switching from flat detail row to modal
let onFlatModeSwitch: ((
  parentIndex: number,
  field: string,
  targetMode: string
) => void) | null = null;

export function setFlatModeSwitchHandler(
  handler: (parentIndex: number, field: string, targetMode: string) => void
): void {
  onFlatModeSwitch = handler;
}

export function createSubtableCellRenderer(params: {
  value: unknown;
  data: Record<string, unknown>;
  node: { rowIndex: number | null };
  colDef: { field?: string };
}): HTMLElement {
  const el = document.createElement('div');
  el.className = 'subtable-cell';

  // Flat detail row: show summary text + switch button on first sub-row
  if (params.data?.__isFlatDetailRow) {
    const summaryText = String(params.value ?? '');
    const label = document.createElement('span');
    label.textContent = summaryText;
    el.appendChild(label);

    // Add switch-to-modal button on the first sub-row (subIndex === 0)
    if (params.data.__subIndex === 0) {
      const switchBtn = document.createElement('button');
      switchBtn.className = 'subtable-expand-btn';
      switchBtn.textContent = '\u2B06'; // ⬆
      switchBtn.title = '\u30E2\u30FC\u30C0\u30EB\u30E2\u30FC\u30C9\u306B\u5207\u66FF'; // モーダルモードに切替
      switchBtn.style.marginLeft = '4px';
      switchBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const parentIndex = params.data.__parentOriginalIndex as number;
        const field = params.data.__subtableField as string;
        onFlatModeSwitch?.(parentIndex, field, 'modal');
      });
      el.appendChild(switchBtn);
    }
    return el;
  }

  const value = params.value;
  if (!Array.isArray(value)) {
    el.textContent = String(value ?? '');
    return el;
  }

  const btn = document.createElement('button');
  btn.className = 'subtable-expand-btn';
  btn.textContent = '\u25B6'; // right-pointing triangle
  btn.title = `${value.length} items`;

  const label = document.createElement('span');
  label.textContent = `[${value.length} items]`;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    // Use __originalIndex to fix rowIndex shift bug when detail/flat rows are inserted
    const rowIndex = (params.data.__originalIndex as number | undefined) ?? params.node.rowIndex;
    const field = params.colDef.field;
    if (rowIndex == null || !field) return;
    toggleSubtablePanel(rowIndex, field, value as SubtableRecord[]);
  });

  el.appendChild(btn);
  el.appendChild(label);
  return el;
}

// --- Panel lifecycle ---

function closeActivePanel(): void {
  if (activeOverlay) {
    activeOverlay.remove();
    activeOverlay = null;
  }
  if (activeDockedContainer) {
    activeDockedContainer.remove();
    activeDockedContainer = null;
    document.body.classList.remove('docked-mode');
  }
  if (activePanelApi) {
    activePanelApi.destroy();
    activePanelApi = null;
  }
  if (escHandler) {
    document.removeEventListener('keydown', escHandler);
    escHandler = null;
  }
  activeKey = null;
}

function toggleSubtablePanel(
  rowIndex: number,
  field: string,
  data: SubtableRecord[]
): void {
  currentMode = normalizeMode(currentMode);
  const key = `${rowIndex}:${field}`;

  if (currentMode === 'flat') {
    // Flat mode: delegate to grid.ts (multiple expansions allowed)
    closeActivePanel(); // close any modal/docked that might be open
    onFlatToggle?.(rowIndex, field, data);
    return;
  }

  if (currentMode === 'inline') {
    // Inline mode: delegate to grid.ts (multiple expansions allowed)
    closeActivePanel(); // close any modal/docked that might be open
    onInlineToggle?.(rowIndex, field, data);
    return;
  }

  // If same cell is clicked, toggle off
  if (activeKey === key) {
    closeActivePanel();
    return;
  }

  // If different cell is clicked, close existing and open new
  closeActivePanel();

  if (data.length === 0) return;

  if (currentMode === 'docked') {
    openAsDocked(rowIndex, field, data, key);
  } else {
    openAsModal(rowIndex, field, data, key);
  }
}

// --- Build shared panel content ---

function buildPanelContent(
  rowIndex: number,
  field: string,
  data: SubtableRecord[],
  switchMode: () => void
): { panel: HTMLElement; gridDiv: HTMLElement; colDefs: ColDef[]; gridOptions: GridOptions } {
  const panel = document.createElement('div');
  panel.className = 'subtable-panel';

  // Header
  const header = document.createElement('div');
  header.className = 'subtable-header';

  const title = document.createElement('strong');
  title.textContent = `${field} (Row ${rowIndex + 1})`;

  const controls = document.createElement('div');
  controls.style.display = 'flex';
  controls.style.gap = '4px';
  controls.style.alignItems = 'center';

  // Auto-size columns button
  const autoSizeBtn = document.createElement('button');
  autoSizeBtn.className = 'subtable-expand-btn';
  autoSizeBtn.textContent = '\u2194'; // ↔
  autoSizeBtn.title = '\u5217\u5E45\u3092\u81EA\u52D5\u8ABF\u6574'; // 列幅を自動調整
  autoSizeBtn.addEventListener('click', () => {
    if (!activePanelApi) return;
    activePanelApi.autoSizeAllColumns();
    clampAutosizedColumnWidths(activePanelApi);
  });

  // Mode toggle button (cycles: modal→docked→inline→modal)
  const modeBtn = document.createElement('button');
  modeBtn.className = 'subtable-expand-btn';
  const nextMode = currentMode === 'modal' ? getNextMode('modal') : getNextMode('docked');
  if (nextMode === 'docked') {
    modeBtn.textContent = '\u2B07'; // ⬇
    modeBtn.title = '\u30C9\u30C3\u30AD\u30F3\u30B0\u30E2\u30FC\u30C9\u306B\u5207\u66FF'; // ドッキングモードに切替
  } else if (nextMode === 'inline') {
    modeBtn.textContent = '\u2195'; // ↕
    modeBtn.title = '\u30A4\u30F3\u30E9\u30A4\u30F3\u30E2\u30FC\u30C9\u306B\u5207\u66FF'; // インラインモードに切替
  } else if (nextMode === 'flat') {
    modeBtn.textContent = '\u2B06'; // ⬆
    modeBtn.title = '\u30D5\u30E9\u30C3\u30C8\u30E2\u30FC\u30C9\u306B\u5207\u66FF'; // フラットモードに切替
  } else {
    modeBtn.textContent = '\u25A1'; // □
    modeBtn.title = '\u30E2\u30FC\u30C0\u30EB\u30E2\u30FC\u30C9\u306B\u5207\u66FF'; // モーダルモードに切替
  }
  modeBtn.addEventListener('click', switchMode);

  // Close button
  const closeBtn = document.createElement('button');
  closeBtn.className = 'subtable-expand-btn';
  closeBtn.textContent = '\u2715'; // ✕
  closeBtn.title = '\u9589\u3058\u308B'; // 閉じる
  closeBtn.addEventListener('click', () => {
    closeActivePanel();
  });

  controls.appendChild(autoSizeBtn);
  controls.appendChild(modeBtn);
  controls.appendChild(closeBtn);

  header.appendChild(title);
  header.appendChild(controls);
  panel.appendChild(header);

  // Grid container
  const gridDiv = document.createElement('div');
  gridDiv.className = 'subtable-grid';

  // Detect theme
  const container = document.getElementById('grid-container');
  if (container?.classList.contains('ag-theme-alpine-dark')) {
    gridDiv.classList.add('ag-theme-alpine-dark');
  } else {
    gridDiv.classList.add('ag-theme-alpine');
  }

  panel.appendChild(gridDiv);

  // Derive columns from data
  const allKeys = new Set<string>();
  for (const row of data) {
    for (const k of Object.keys(row)) {
      allKeys.add(k);
    }
  }

  const pw = getCellWrapEnabled();
  const colDefs: ColDef[] = [...allKeys].map((k) => ({
    field: k,
    headerName: k,
    editable: true,
    resizable: true,
    sortable: true,
    minWidth: 80,
    wrapText: pw,
    autoHeight: false,
    cellClass: pw ? WRAP_CELL_SCROLL_CLASS : undefined,
  }));

  const gridOptions: GridOptions = {
    columnDefs: colDefs,
    rowData: data.map((row, idx) => ({ ...row, __subIndex: idx })),
    domLayout: currentMode === 'docked' ? 'normal' : 'autoHeight',
    rowHeight: pw ? WRAP_MODE_ROW_HEIGHT_PX : SUBTABLE_PANEL_ROW_HEIGHT_DEFAULT_PX,
    defaultColDef: {
      flex: 1,
      minWidth: 80,
      wrapText: pw,
      autoHeight: false,
    },
    getMainMenuItems: getMainMenuItemsWithSetColumnWidth,
    autoSizeStrategy: {
      type: 'fitCellContents',
    },
    onFirstDataRendered: (e) => {
      clampAutosizedColumnWidths(e.api);
    },
    onCellValueChanged: (event) => {
      if (onSubtableEdit && event.colDef.field && event.colDef.field !== '__subIndex') {
        const subIndex = event.data.__subIndex;
        onSubtableEdit(rowIndex, field, subIndex, event.colDef.field, event.oldValue, event.newValue);
      }
    },
  };

  return { panel, gridDiv, colDefs, gridOptions };
}

// --- Modal mode ---

function openAsModal(
  rowIndex: number,
  field: string,
  data: SubtableRecord[],
  key: string
): void {
  const switchMode = () => {
    closeActivePanel();
    switchModeFromPanel('modal', rowIndex, field, data, key);
  };

  const { panel, gridDiv, gridOptions } = buildPanelContent(
    rowIndex, field, data, switchMode
  );

  const overlay = document.createElement('div');
  overlay.className = 'subtable-overlay';
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      closeActivePanel();
    }
  });

  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  activePanelApi = createGrid(gridDiv, gridOptions);
  activeOverlay = overlay;
  activeKey = key;

  escHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeActivePanel();
    }
  };
  document.addEventListener('keydown', escHandler);
}

// --- Docked mode ---

function openAsDocked(
  rowIndex: number,
  field: string,
  data: SubtableRecord[],
  key: string
): void {
  const switchMode = () => {
    closeActivePanel();
    switchModeFromPanel('docked', rowIndex, field, data, key);
  };

  const { panel, gridDiv, gridOptions } = buildPanelContent(
    rowIndex, field, data, switchMode
  );

  // Remove modal-specific styles for docked panel
  panel.classList.remove('subtable-panel');
  panel.classList.add('subtable-panel', 'subtable-panel-docked');

  const dockedContainer = document.createElement('div');
  dockedContainer.className = 'subtable-docked';
  dockedContainer.appendChild(panel);

  document.body.classList.add('docked-mode');
  document.body.appendChild(dockedContainer);

  activePanelApi = createGrid(gridDiv, gridOptions);
  activeDockedContainer = dockedContainer;
  activeKey = key;

  escHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeActivePanel();
    }
  };
  document.addEventListener('keydown', escHandler);
}

// --- Public API ---

/** Open subtable in a specific mode (called when switching from inline) */
export function switchAndOpen(
  mode: 'modal' | 'docked',
  rowIndex: number,
  field: string,
  data: SubtableRecord[]
): void {
  currentMode = normalizeMode(mode);
  localStorage.setItem('subtable-panel-mode', currentMode);
  const key = `${rowIndex}:${field}`;
  if (mode === 'modal') {
    openAsModal(rowIndex, field, data, key);
  } else {
    openAsDocked(rowIndex, field, data, key);
  }
}

export function refreshActivePanelCellWrap(): void {
  if (!activePanelApi) return;
  const w = getCellWrapEnabled();
  activePanelApi.setGridOption(
    'rowHeight',
    w ? WRAP_MODE_ROW_HEIGHT_PX : SUBTABLE_PANEL_ROW_HEIGHT_DEFAULT_PX
  );
  activePanelApi.setGridOption('defaultColDef', {
    flex: 1,
    minWidth: 80,
    wrapText: w,
    autoHeight: false,
  });
  const defs = activePanelApi.getColumnDefs();
  if (defs) {
    activePanelApi.setGridOption(
      'columnDefs',
      defs.map((d) => ({
        ...d,
        wrapText: w,
        autoHeight: false,
        cellClass: w ? WRAP_CELL_SCROLL_CLASS : undefined,
      }))
    );
  }
  activePanelApi.resetRowHeights();
}

export function autoSizeClampActiveSubtablePanel(): void {
  if (!activePanelApi) return;
  activePanelApi.autoSizeAllColumns();
  clampAutosizedColumnWidths(activePanelApi);
}

export function closeSubtablePanel(): void {
  closeActivePanel();
}

function normalizeMode(mode: PanelMode): PanelMode {
  return allowedModes.includes(mode) ? mode : 'modal';
}

function getNextMode(mode: 'modal' | 'docked'): PanelMode {
  const currentIndex = allowedModes.indexOf(mode);
  const nextIndex = (currentIndex + 1) % allowedModes.length;
  return allowedModes[nextIndex];
}

function switchModeFromPanel(
  mode: 'modal' | 'docked',
  rowIndex: number,
  field: string,
  data: SubtableRecord[],
  key: string
): void {
  currentMode = getNextMode(mode);
  localStorage.setItem('subtable-panel-mode', currentMode);

  if (currentMode === 'modal') {
    openAsModal(rowIndex, field, data, key);
    return;
  }
  if (currentMode === 'docked') {
    openAsDocked(rowIndex, field, data, key);
    return;
  }
  if (currentMode === 'inline') {
    onInlineToggle?.(rowIndex, field, data);
    return;
  }
  onFlatToggle?.(rowIndex, field, data);
}
