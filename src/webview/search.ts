import type { GridApi } from 'ag-grid-community';
import type { SearchResultSummary } from '../types';
import { JSONL_LINE_NUMBER_COL_ID } from './lineNumberPreference';
import { AG_GRID_CONTROLS_COLUMN_ID } from './rowHeightDrag';

export class SearchController {
  private _api: GridApi | null = null;
  private _searchText = '';
  private _matchCount = 0;
  private _currentMatchIndex = -1;
  private _matches: Array<{ rowIndex: number; colId: string }> = [];
  private _largeFileMode = false;

  private readonly _input: HTMLInputElement;
  private readonly _countSpan: HTMLElement;
  private readonly _prevBtn: HTMLButtonElement;
  private readonly _nextBtn: HTMLButtonElement;
  private readonly _remoteQuery: (query: string) => void;
  private readonly _remoteStep: (direction: 'next' | 'prev') => void;

  constructor(
    remoteQuery: (query: string) => void,
    remoteStep: (direction: 'next' | 'prev') => void
  ) {
    this._remoteQuery = remoteQuery;
    this._remoteStep = remoteStep;

    this._input = document.getElementById('search-input') as HTMLInputElement;
    this._countSpan = document.getElementById('search-count') as HTMLElement;
    this._prevBtn = document.getElementById('search-prev') as HTMLButtonElement;
    this._nextBtn = document.getElementById('search-next') as HTMLButtonElement;

    this._input.addEventListener('input', () => this._onSearch());
    this._input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (e.shiftKey) {
          this.prevMatch();
        } else {
          this.nextMatch();
        }
      }
      if (e.key === 'Escape') {
        this._input.value = '';
        this._onSearch();
        this._input.blur();
      }
    });
    this._prevBtn.addEventListener('click', () => this.prevMatch());
    this._nextBtn.addEventListener('click', () => this.nextMatch());
  }

  setGridApi(api: GridApi): void {
    this._api = api;
  }

  setLargeFileMode(enabled: boolean): void {
    this._largeFileMode = enabled;
    this._matches = [];
    this._matchCount = 0;
    this._currentMatchIndex = -1;
    this._updateCount();
  }

  applyRemoteResult(result: SearchResultSummary): void {
    if (!this._largeFileMode) return;

    const currentInput = this._input.value.trim().toLowerCase();
    if (result.query !== currentInput) return;

    this._searchText = result.query;
    this._matchCount = result.totalMatches;
    this._currentMatchIndex = result.currentMatchIndex;
    this._updateCount();
  }

  private _onSearch(): void {
    this._searchText = this._input.value.trim().toLowerCase();

    if (this._largeFileMode) {
      this._matches = [];
      this._matchCount = 0;
      this._currentMatchIndex = -1;
      this._countSpan.textContent =
        this._searchText === '' ? '' : 'Searching...';
      this._remoteQuery(this._searchText);
      return;
    }

    if (!this._api || this._searchText === '') {
      this._matches = [];
      this._matchCount = 0;
      this._currentMatchIndex = -1;
      this._updateCount();
      this._api?.setGridOption('quickFilterText', '');
      return;
    }

    this._api.setGridOption('quickFilterText', this._searchText);

    this._matches = [];
    this._api.forEachNodeAfterFilterAndSort((node) => {
      if (node.data) {
        if (node.data.__isFlatDetailRow || node.data.__isDetailRow) return;
        const cols = this._api!.getColumns();
        if (cols) {
          for (const col of cols) {
            const cid = col.getColId();
            if (cid === JSONL_LINE_NUMBER_COL_ID || cid.startsWith(AG_GRID_CONTROLS_COLUMN_ID)) {
              continue;
            }
            const value = this._valueToSearchText(node.data[col.getColId()]);
            if (value.includes(this._searchText)) {
              this._matches.push({
                rowIndex: node.rowIndex!,
                colId: col.getColId(),
              });
            }
          }
        }
      }
    });

    this._matchCount = this._matches.length;
    this._currentMatchIndex = this._matchCount > 0 ? 0 : -1;
    this._updateCount();

    if (this._currentMatchIndex >= 0) {
      this._navigateToMatch(this._currentMatchIndex);
    }
  }

  nextMatch(): void {
    if (this._largeFileMode) {
      if (this._searchText === '') return;
      this._remoteStep('next');
      return;
    }

    if (this._matchCount === 0) return;
    this._currentMatchIndex = (this._currentMatchIndex + 1) % this._matchCount;
    this._updateCount();
    this._navigateToMatch(this._currentMatchIndex);
  }

  prevMatch(): void {
    if (this._largeFileMode) {
      if (this._searchText === '') return;
      this._remoteStep('prev');
      return;
    }

    if (this._matchCount === 0) return;
    this._currentMatchIndex =
      (this._currentMatchIndex - 1 + this._matchCount) % this._matchCount;
    this._updateCount();
    this._navigateToMatch(this._currentMatchIndex);
  }

  private _navigateToMatch(index: number): void {
    if (!this._api || index < 0 || index >= this._matches.length) return;
    const match = this._matches[index];
    this._api.ensureIndexVisible(match.rowIndex);
    this._api.ensureColumnVisible(match.colId);
  }

  private _valueToSearchText(value: unknown): string {
    if (Array.isArray(value)) {
      return value
        .map((item) => {
          if (item != null && typeof item === 'object') {
            return Object.values(item as Record<string, unknown>)
              .map((v) => (v != null ? String(v) : ''))
              .join(' ');
          }
          return item != null ? String(item) : '';
        })
        .join(' ')
        .toLowerCase();
    }
    return String(value ?? '').toLowerCase();
  }

  private _updateCount(): void {
    if (this._searchText === '') {
      this._countSpan.textContent = '';
    } else if (this._matchCount === 0) {
      this._countSpan.textContent = 'No matches';
    } else {
      this._countSpan.textContent = `${this._currentMatchIndex + 1} / ${this._matchCount}`;
    }
  }
}
