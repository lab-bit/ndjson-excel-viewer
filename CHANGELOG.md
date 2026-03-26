# Changelog

## 0.3.1

- Reissued the release as `0.3.1` so it can be published cleanly after the `v0.3.0` tag had already been created.
- Expanded the changelog to document the actual end-user changes delivered in the 0.3.x release line instead of leaving only the package rename note.
- No additional functional code changes were added beyond release metadata and documentation alignment.

## 0.3.0

### Changed

- Extension name and package identity were finalized as **JSONL Excel Viewer**.
- Marketplace/package ID was unified to `jsonl-excel-viewer`.
- Internal module names and source files were renamed from `ndjson*` to `jsonl*` to match the new product naming.
- `.ndjson` files remain supported as a legacy format, while `.jsonl` is now the primary format throughout the UI and documentation.

### Added

- Search toolbar for JSONL data with:
  - incremental search input
  - match count display
  - next / previous match navigation
  - keyboard support for `Ctrl+F` / `Cmd+F`, `Enter`, and `Shift+Enter`
- Extension-host-backed search handling for large datasets, including match focusing to the exact row and column.
- Grid options menu with:
  - `Wrap text` toggle
  - `Show line numbers` toggle
  - bulk subtable actions (`Inline All`, `Flat All`)
- Per-row height resizing by drag when wrapped cell display is enabled.
- Large file mode with automatic activation based on file size / row count / column count thresholds.
- Large file status indicator showing file size, row count, and column count.
- Column width numeric input parsing and width limit handling to keep manual resizing predictable.
- Persistent webview UI state for wrap-text and line-number visibility preferences during editor sessions.

### Improved

- Wrapped cell rendering now uses a controlled fixed-row layout with inner scrolling, avoiding unstable row auto-growth on dense tables.
- Main grid and nested subtable grids now apply wrap settings more consistently.
- Search results stay in sync after edits, undo, and redo by invalidating and rebuilding per-row search cache entries.
- Bulk inline/flat subtable expansion is disabled automatically in large file mode to preserve rendering and scrolling responsiveness.
- Toolbar and info bar behavior were refined to better surface active grid state and dataset size.
- Tests were expanded for parser/serializer rename coverage, large-file mode rules, row-height resolution, wrapped-cell layout, and column-width validation.

## 0.2.0 - Rename to JSONL Excel Viewer

- **Breaking:** Extension renamed from "NDJSON Excel Viewer" to "JSONL Excel Viewer" (NDJSON was deprecated in 2023 in favor of JSONL).
- Extension ID is now `jsonl-excel-viewer`. View type is `jsonlExcelViewer.editor`.
- `.ndjson` and `.jsonl` files are still both supported.

## 0.1.0 - Initial release

- Spreadsheet-like grid view for `.ndjson` and `.jsonl` files
- Inline cell editing with Undo / Redo
- Subtable expansion: Modal, Docked, Inline, and Flat modes
- Bulk expand / collapse (Inline All / Flat All)
- Quick-filter search with match navigation
- Light / dark theme support
- Chunked loading with virtual scrolling
