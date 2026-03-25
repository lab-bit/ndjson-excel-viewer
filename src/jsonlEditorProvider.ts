import * as vscode from 'vscode';
import { JsonlDocument } from './jsonlDocument';
import { analyzeColumns } from './columnAnalyzer';
import {
  GridStats,
  SearchMatch,
  WebviewToExtMessage,
} from './types';
import { shouldEnableLargeFileMode } from './largeFileMode';

export class JsonlEditorProvider
  implements vscode.CustomEditorProvider<JsonlDocument>
{
  public static readonly viewType = 'jsonlExcelViewer.editor';

  private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<
    vscode.CustomDocumentEditEvent<JsonlDocument>
  >();
  public readonly onDidChangeCustomDocument =
    this._onDidChangeCustomDocument.event;

  constructor(private readonly _context: vscode.ExtensionContext) {}

  async openCustomDocument(
    uri: vscode.Uri,
    _openContext: vscode.CustomDocumentOpenContext,
    _token: vscode.CancellationToken
  ): Promise<JsonlDocument> {
    const document = await JsonlDocument.create(uri);

    // Forward document change events to VSCode
    document.onDidChange((e) => {
      this._onDidChangeCustomDocument.fire({
        document,
        ...e,
      });
    });

    return document;
  }

  async resolveCustomEditor(
    document: JsonlDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    let activeSearchQuery = '';
    let activeSearchMatches: SearchMatch[] = [];
    let activeSearchIndex = -1;

    const updateSearch = () => {
      if (activeSearchQuery === '') {
        activeSearchMatches = [];
        activeSearchIndex = -1;
        webviewPanel.webview.postMessage({
          type: 'search-result',
          result: {
            query: '',
            totalMatches: 0,
            currentMatchIndex: -1,
          },
        });
        return;
      }

      activeSearchMatches = document.search(activeSearchQuery);
      activeSearchIndex = activeSearchMatches.length > 0 ? 0 : -1;
      this._postSearchState(
        webviewPanel.webview,
        activeSearchQuery,
        activeSearchMatches,
        activeSearchIndex
      );
    };

    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this._context.extensionUri, 'dist'),
        vscode.Uri.joinPath(this._context.extensionUri, 'media'),
      ],
    };

    webviewPanel.webview.html = this._getHtmlForWebview(
      webviewPanel.webview
    );

    // Handle messages from the webview
    webviewPanel.webview.onDidReceiveMessage(
      (message: WebviewToExtMessage) => {
        switch (message.type) {
          case 'ready':
            this._sendInitData(webviewPanel.webview, document);
            break;
          case 'cell-edit':
            document.applyEdit(message.edit);
            break;
          case 'request-rows':
            this._sendRowsRange(
              webviewPanel.webview,
              document,
              message.requestId,
              message.startRow,
              message.endRow
            );
            break;
          case 'search-query':
            activeSearchQuery = message.query.trim();
            updateSearch();
            break;
          case 'search-step':
            if (activeSearchMatches.length === 0) {
              this._postSearchState(
                webviewPanel.webview,
                activeSearchQuery,
                activeSearchMatches,
                activeSearchIndex
              );
              break;
            }
            activeSearchIndex =
              message.direction === 'next'
                ? (activeSearchIndex + 1) % activeSearchMatches.length
                : (activeSearchIndex - 1 + activeSearchMatches.length) %
                  activeSearchMatches.length;
            this._postSearchState(
              webviewPanel.webview,
              activeSearchQuery,
              activeSearchMatches,
              activeSearchIndex
            );
            break;
        }
      }
    );

    document.onDidChangeContent((event) => {
      if (event.type === 'reload') {
        this._sendInitData(webviewPanel.webview, document);
        updateSearch();
        return;
      }

      if (event.source !== 'local') {
        webviewPanel.webview.postMessage({
          type: 'apply-edit',
          edit: event.edit,
        });
      }

      if (activeSearchQuery !== '') {
        const previousMatch = activeSearchMatches[activeSearchIndex];
        activeSearchMatches = document.search(activeSearchQuery);
        if (activeSearchMatches.length === 0) {
          activeSearchIndex = -1;
        } else if (previousMatch) {
          const nextIndex = activeSearchMatches.findIndex(
            (match) =>
              match.rowIndex === previousMatch.rowIndex &&
              match.colId === previousMatch.colId
          );
          activeSearchIndex = nextIndex >= 0 ? nextIndex : 0;
        } else {
          activeSearchIndex = 0;
        }
        this._postSearchState(
          webviewPanel.webview,
          activeSearchQuery,
          activeSearchMatches,
          activeSearchIndex
        );
      }
    });

    // Theme change listener
    vscode.window.onDidChangeActiveColorTheme((theme) => {
      webviewPanel.webview.postMessage({
        type: 'theme-changed',
        theme: theme.kind === vscode.ColorThemeKind.Dark
          ? 'dark'
          : theme.kind === vscode.ColorThemeKind.HighContrast
            ? 'high-contrast'
            : 'light',
      });
    });
  }

  async saveCustomDocument(
    document: JsonlDocument,
    cancellation: vscode.CancellationToken
  ): Promise<void> {
    await document.save(cancellation);
  }

  async saveCustomDocumentAs(
    document: JsonlDocument,
    destination: vscode.Uri,
    cancellation: vscode.CancellationToken
  ): Promise<void> {
    await document.saveAs(destination);
  }

  async revertCustomDocument(
    document: JsonlDocument,
    cancellation: vscode.CancellationToken
  ): Promise<void> {
    await document.revert();
  }

  async backupCustomDocument(
    document: JsonlDocument,
    context: vscode.CustomDocumentBackupContext,
    cancellation: vscode.CancellationToken
  ): Promise<vscode.CustomDocumentBackup> {
    return document.backup(context.destination, cancellation);
  }

  private _sendInitData(
    webview: vscode.Webview,
    document: JsonlDocument
  ): void {
    const records = document.records;
    const columns = analyzeColumns(records);
    const stats: GridStats = {
      fileSizeBytes: document.fileSizeBytes,
      totalRows: records.length,
      totalColumns: columns.length,
    };
    const largeFileMode = shouldEnableLargeFileMode(stats);

    webview.postMessage({
      type: 'init',
      columns,
      totalRows: records.length,
      largeFileMode,
      stats,
    });
  }

  private _sendRowsRange(
    webview: vscode.Webview,
    document: JsonlDocument,
    requestId: number,
    startRow: number,
    endRow: number
  ): void {
    const safeStart = Math.max(0, startRow);
    const safeEnd = Math.max(safeStart, endRow);
    const rows = document.getRowsRange(safeStart, safeEnd);
    webview.postMessage({
      type: 'rows-range',
      requestId,
      startRow: safeStart,
      endRow: safeEnd,
      rows,
      lastRow: document.records.length,
    });
  }

  private _postSearchState(
    webview: vscode.Webview,
    query: string,
    matches: SearchMatch[],
    currentIndex: number
  ): void {
    webview.postMessage({
      type: 'search-result',
      result: {
        query,
        totalMatches: matches.length,
        currentMatchIndex: currentIndex,
      },
    });

    if (currentIndex >= 0 && currentIndex < matches.length) {
      webview.postMessage({
        type: 'focus-match',
        match: matches[currentIndex],
      });
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._context.extensionUri, 'dist', 'webview.js')
    );
    const agGridCssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._context.extensionUri, 'dist', 'webview.css')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._context.extensionUri, 'media', 'styles.css')
    );

    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource} data:;">
  <link href="${agGridCssUri}" rel="stylesheet">
  <link href="${styleUri}" rel="stylesheet">
  <title>JSONL Excel Viewer</title>
</head>
<body>
  <div id="toolbar">
    <div id="search-container">
      <input type="text" id="search-input" placeholder="Search..." />
      <span id="search-count"></span>
      <button id="search-prev" title="Previous">&#9650;</button>
      <button id="search-next" title="Next">&#9660;</button>
    </div>
    <div id="info-bar">
      <div id="grid-menu-wrap">
        <button id="grid-menu-btn" type="button" title="Grid options">Menu</button>
        <div id="grid-menu-dropdown" class="grid-menu-dropdown" aria-hidden="true">
          <label class="grid-menu-item">
            <input type="checkbox" id="grid-wrap-text" checked />
            <span>Wrap text</span>
          </label>
          <label class="grid-menu-item">
            <input type="checkbox" id="grid-show-line-numbers" checked />
            <span>Show line numbers</span>
          </label>
          <div class="grid-menu-section">
            <button type="button" id="grid-menu-inline-all" class="grid-menu-action-btn">
              Inline All
            </button>
            <button type="button" id="grid-menu-flat-all" class="grid-menu-action-btn">
              Flat All
            </button>
          </div>
        </div>
      </div>
      <div id="column-picker-wrap">
        <button id="column-picker-btn" title="Select columns to display">Columns</button>
        <div id="column-picker-dropdown" class="column-picker-dropdown" aria-hidden="true"></div>
      </div>
      <span id="mode-indicator" hidden></span>
      <span id="row-count"></span>
      <span id="col-count"></span>
    </div>
  </div>
  <div id="grid-container"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const possible =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
