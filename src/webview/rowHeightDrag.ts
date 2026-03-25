import type {
  GridApi,
  ICellRendererParams,
  IRowNode,
  RowNode,
} from 'ag-grid-community';
import { WRAP_MODE_ROW_HEIGHT_PX } from './wrapCellLayout';

/** Same key as row annotation in `grid.ts` / `jsonlDocument`. */
export const JSONL_ROW_INDEX_FIELD = '__jsonlRowIndex';

/** AG Grid built-in selection (checkbox) column id prefix. */
export const AG_GRID_CONTROLS_COLUMN_ID = 'ag-Grid-ControlsColumn';

/** Match `media/styles.css` `--ag-row-height` fallback when wrap is off. */
export const DEFAULT_THEME_ROW_HEIGHT_PX = 28;

export const ROW_HEIGHT_MIN_PX = 28;
export const ROW_HEIGHT_MAX_PX = 800;

const customRowHeightsPx = new Map<number, number>();

export function clearCustomRowHeights(): void {
  customRowHeightsPx.clear();
}

export function getCustomRowHeight(rowIndex: number): number | undefined {
  return customRowHeightsPx.get(rowIndex);
}

export function setCustomRowHeight(rowIndex: number, heightPx: number): void {
  customRowHeightsPx.set(rowIndex, clampRowHeightPx(heightPx));
}

export function clampRowHeightPx(h: number): number {
  return Math.min(ROW_HEIGHT_MAX_PX, Math.max(ROW_HEIGHT_MIN_PX, Math.round(h)));
}

export interface ResolveMainGridRowHeightInput {
  data: Record<string, unknown> | undefined;
  largeFileMode: boolean;
  cellWrapEnabled: boolean;
  wrapModeRowHeightPx: number;
  customHeights: ReadonlyMap<number, number>;
}

/**
 * Pure height resolution for the main grid (tests + `getRowHeight`).
 * Returns `undefined` to let AG Grid use its theme default.
 */
export function resolveMainGridRowHeightPx(
  input: ResolveMainGridRowHeightInput
): number | undefined {
  const d = input.data;
  if (!d) return undefined;

  if (!input.largeFileMode && d.__isDetailRow === true) {
    const raw = (d as { __subtableData?: unknown }).__subtableData;
    const itemCount = Array.isArray(raw) ? raw.length : 0;
    return Math.min(Math.max(32 + itemCount * 24 + 16, 120), 300);
  }

  if (d.__isFlatDetailRow === true) {
    return input.cellWrapEnabled ? input.wrapModeRowHeightPx : undefined;
  }

  const idx = d[JSONL_ROW_INDEX_FIELD];
  if (typeof idx === 'number' && input.cellWrapEnabled) {
    const custom = input.customHeights.get(idx);
    if (custom != null) return custom;
  }

  if (input.cellWrapEnabled) return input.wrapModeRowHeightPx;
  return undefined;
}

export function resolveRowHeightForGrid(params: {
  data: Record<string, unknown> | undefined;
  largeFileMode: boolean;
  cellWrapEnabled: boolean;
}): number | undefined {
  return resolveMainGridRowHeightPx({
    data: params.data,
    largeFileMode: params.largeFileMode,
    cellWrapEnabled: params.cellWrapEnabled,
    wrapModeRowHeightPx: WRAP_MODE_ROW_HEIGHT_PX,
    customHeights: customRowHeightsPx,
  });
}

function attachRowHeightPointerDrag(
  grip: HTMLElement,
  args: {
    api: GridApi;
    node: IRowNode;
    rowIndex: number;
    getDefaultRowHeightPx: () => number;
  }
): void {
  grip.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const startY = e.clientY;
    const baseH =
      getCustomRowHeight(args.rowIndex) ?? args.getDefaultRowHeightPx();

    grip.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      ev.preventDefault();
      const next = clampRowHeightPx(baseH + (ev.clientY - startY));
      setCustomRowHeight(args.rowIndex, next);
      args.node.setRowHeight(next);
      args.api.onRowHeightChanged();
      args.api.redrawRows({ rowNodes: [args.node] });
    };

    const onUp = (ev: PointerEvent) => {
      try {
        grip.releasePointerCapture(ev.pointerId);
      } catch {
        /* ignore */
      }
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  });
}

export function createLeadColumnCellRenderer(options: {
  showLineNumber: boolean;
  /** When false (Wrap text OFF), no row-height grip is shown. */
  showResizeGrip: boolean;
  getDefaultRowHeightPx: () => number;
}): (params: ICellRendererParams) => HTMLElement {
  return (params: ICellRendererParams) => {
    const root = document.createElement('div');
    root.className = options.showLineNumber
      ? 'jsonl-lead-cell-root jsonl-line-number-cell-inner'
      : 'jsonl-lead-cell-root jsonl-row-gutter-cell-inner';

    const d = params.data as Record<string, unknown> | undefined;
    const isDetail = d?.__isDetailRow === true || d?.__isFlatDetailRow === true;

    if (options.showLineNumber) {
      const label = document.createElement('span');
      label.className = 'jsonl-line-no-value';
      const v = params.value;
      label.textContent = v != null && v !== '' ? String(v) : '';
      root.appendChild(label);
    }

    if (options.showResizeGrip && !isDetail) {
      const grip = document.createElement('div');
      grip.className = 'jsonl-row-height-grip';
      grip.title = '\u884C\u306E\u9AD8\u3055\u3092\u30C9\u30E9\u30C3\u30B0\u3067\u5909\u66F4';
      const idx = d?.[JSONL_ROW_INDEX_FIELD];
      if (typeof idx === 'number') {
        attachRowHeightPointerDrag(grip, {
          api: params.api,
          node: params.node,
          rowIndex: idx,
          getDefaultRowHeightPx: options.getDefaultRowHeightPx,
        });
      }
      root.appendChild(grip);
    }

    return root;
  };
}

/**
 * Checkbox column body when line numbers are hidden: checkbox + bottom row-height grip (Wrap ON only).
 */
export function createSelectionColumnWithGripRenderer(options: {
  getDefaultRowHeightPx: () => number;
}): (params: ICellRendererParams) => HTMLElement {
  return (params: ICellRendererParams) => {
    const root = document.createElement('div');
    root.className = 'jsonl-selection-cell-root jsonl-lead-cell';

    const cbWrap = document.createElement('div');
    cbWrap.className = 'jsonl-selection-checkbox-wrap';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'jsonl-selection-native-cb';
    input.tabIndex = -1;

    const rowNode = params.node as RowNode;

    const sync = (): void => {
      const s = rowNode.isSelected();
      input.checked = s === true;
      input.indeterminate = s === undefined;
    };
    sync();

    input.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const me = e as MouseEvent;
      const cur = rowNode.isSelected();
      const newValue = cur !== true;
      rowNode.setSelectedParams({
        newValue,
        rangeSelect: me.shiftKey,
        groupSelectsFiltered: false,
        source: 'checkboxSelected',
        event: me,
      });
      sync();
    });

    const onRowSelected = (): void => {
      sync();
    };
    rowNode.addEventListener('rowSelected', onRowSelected);

    cbWrap.appendChild(input);
    root.appendChild(cbWrap);

    const d = params.data as Record<string, unknown> | undefined;
    const isDetail = d?.__isDetailRow === true || d?.__isFlatDetailRow === true;
    if (!isDetail) {
      const grip = document.createElement('div');
      grip.className = 'jsonl-row-height-grip';
      grip.title = '\u884C\u306E\u9AD8\u3055\u3092\u30C9\u30E9\u30C3\u30B0\u3067\u5909\u66F4';
      const idx = d?.[JSONL_ROW_INDEX_FIELD];
      if (typeof idx === 'number') {
        attachRowHeightPointerDrag(grip, {
          api: params.api,
          node: params.node,
          rowIndex: idx,
          getDefaultRowHeightPx: options.getDefaultRowHeightPx,
        });
      }
      root.appendChild(grip);
    }

    return root;
  };
}
