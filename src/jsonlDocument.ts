import * as vscode from 'vscode';
import { JsonlRecord, CellEdit, SearchMatch } from './types';
import { parseJsonl } from './jsonlParser';
import { serializeJsonl } from './jsonlSerializer';

export class JsonlDocument implements vscode.CustomDocument {
  private _records: JsonlRecord[] = [];
  private _editStack: CellEdit[] = [];
  private _savedEditIndex = 0;
  private _currentEditIndex = 0;
  private _fileSizeBytes = 0;
  private _rowSearchCache = new Map<number, Map<string, string>>();

  private readonly _onDidChange = new vscode.EventEmitter<{
    readonly label: string;
    undo(): void;
    redo(): void;
  }>();
  public readonly onDidChange = this._onDidChange.event;

  private readonly _onDidChangeContent = new vscode.EventEmitter<
    | { type: 'reload' }
    | { type: 'edit'; source: 'local' | 'undo' | 'redo'; edit: CellEdit }
  >();
  public readonly onDidChangeContent = this._onDidChangeContent.event;

  static async create(uri: vscode.Uri): Promise<JsonlDocument> {
    const doc = new JsonlDocument(uri);
    await doc._load();
    return doc;
  }

  private constructor(public readonly uri: vscode.Uri) {}

  private async _load(): Promise<void> {
    const data = await vscode.workspace.fs.readFile(this.uri);
    this._fileSizeBytes = data.byteLength;
    const decoder = new TextDecoder('utf-8');
    const text = decoder.decode(data);
    const result = parseJsonl(text);
    this._records = result.records;
    this._rowSearchCache.clear();

    if (result.errors.length > 0) {
      const errorLines = result.errors.map(e => `Line ${e.line}: ${e.message}`).join('\n');
      vscode.window.showWarningMessage(
        `JSONL parse warnings: ${result.errors.length} line(s) skipped. Check Output for details.`
      );
      const channel = vscode.window.createOutputChannel('JSONL Excel Viewer');
      channel.appendLine(`Parse errors in ${this.uri.fsPath}:`);
      channel.appendLine(errorLines);
    }
  }

  get records(): JsonlRecord[] {
    return this._records;
  }

  get fileSizeBytes(): number {
    return this._fileSizeBytes;
  }

  get isDirty(): boolean {
    return this._currentEditIndex !== this._savedEditIndex;
  }

  applyEdit(edit: CellEdit): void {
    // Truncate any undone edits
    this._editStack.length = this._currentEditIndex;

    // Apply the edit to records
    if (edit.rowIndex >= 0 && edit.rowIndex < this._records.length) {
      this._records[edit.rowIndex][edit.field] = edit.newValue;
      this._invalidateRowSearchCache(edit.rowIndex);
    }

    this._editStack.push(edit);
    this._currentEditIndex++;

    // Fire change event with undo/redo
    this._onDidChange.fire({
      label: `Edit ${edit.field}`,
      undo: () => {
        this._currentEditIndex--;
        const e = this._editStack[this._currentEditIndex];
        if (e.rowIndex >= 0 && e.rowIndex < this._records.length) {
          this._records[e.rowIndex][e.field] = e.oldValue;
          this._invalidateRowSearchCache(e.rowIndex);
        }
        this._onDidChangeContent.fire({
          type: 'edit',
          source: 'undo',
          edit: {
            rowIndex: e.rowIndex,
            field: e.field,
            oldValue: e.newValue,
            newValue: e.oldValue,
          },
        });
      },
      redo: () => {
        const e = this._editStack[this._currentEditIndex];
        if (e.rowIndex >= 0 && e.rowIndex < this._records.length) {
          this._records[e.rowIndex][e.field] = e.newValue;
          this._invalidateRowSearchCache(e.rowIndex);
        }
        this._currentEditIndex++;
        this._onDidChangeContent.fire({
          type: 'edit',
          source: 'redo',
          edit: { ...e },
        });
      },
    });

    this._onDidChangeContent.fire({
      type: 'edit',
      source: 'local',
      edit: { ...edit },
    });
  }

  getRowsRange(startRow: number, endRow: number): JsonlRecord[] {
    return this._records.slice(startRow, endRow);
  }

  search(query: string): SearchMatch[] {
    const normalized = query.trim().toLowerCase();
    if (normalized === '') return [];

    const matches: SearchMatch[] = [];
    for (let rowIndex = 0; rowIndex < this._records.length; rowIndex++) {
      const cellMap = this._getRowSearchText(rowIndex);
      for (const [field, text] of cellMap) {
        if (text.includes(normalized)) {
          matches.push({ rowIndex, colId: field });
        }
      }
    }
    return matches;
  }

  async save(cancellation?: vscode.CancellationToken): Promise<void> {
    const text = serializeJsonl(this._records);
    const encoder = new TextEncoder();
    const encoded = encoder.encode(text);
    await vscode.workspace.fs.writeFile(this.uri, encoded);
    this._fileSizeBytes = encoded.byteLength;
    this._savedEditIndex = this._currentEditIndex;
  }

  async saveAs(targetUri: vscode.Uri): Promise<void> {
    const text = serializeJsonl(this._records);
    const encoder = new TextEncoder();
    const encoded = encoder.encode(text);
    await vscode.workspace.fs.writeFile(targetUri, encoded);
    this._fileSizeBytes = encoded.byteLength;
    this._savedEditIndex = this._currentEditIndex;
  }

  async revert(): Promise<void> {
    await this._load();
    this._editStack = [];
    this._currentEditIndex = 0;
    this._savedEditIndex = 0;
    this._onDidChangeContent.fire({ type: 'reload' });
  }

  async backup(
    destination: vscode.Uri,
    cancellation: vscode.CancellationToken
  ): Promise<vscode.CustomDocumentBackup> {
    await this.saveAs(destination);
    return {
      id: destination.toString(),
      delete: async () => {
        try {
          await vscode.workspace.fs.delete(destination);
        } catch {
          // ignore
        }
      },
    };
  }

  dispose(): void {
    this._onDidChange.dispose();
    this._onDidChangeContent.dispose();
  }

  private _getRowSearchText(rowIndex: number): Map<string, string> {
    const cached = this._rowSearchCache.get(rowIndex);
    if (cached) return cached;

    const row = this._records[rowIndex] ?? {};
    const cellMap = new Map<string, string>();
    for (const [field, value] of Object.entries(row)) {
      cellMap.set(field, normalizeSearchValue(value));
    }
    this._rowSearchCache.set(rowIndex, cellMap);
    return cellMap;
  }

  private _invalidateRowSearchCache(rowIndex: number): void {
    this._rowSearchCache.delete(rowIndex);
  }
}

function normalizeSearchValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (item != null && typeof item === 'object') {
          return Object.values(item as Record<string, unknown>)
            .map((nested) => normalizeSearchValue(nested))
            .join(' ');
        }
        return String(item ?? '');
      })
      .join(' ')
      .toLowerCase();
  }

  if (value != null && typeof value === 'object') {
    return JSON.stringify(value).toLowerCase();
  }

  return String(value ?? '').toLowerCase();
}
