# Repository Guidelines

## Project Structure & Module Organization
This repository is a VS Code extension that displays JSONL/NDJSON as a table. Extension code lives under `src/`; Webview UI lives under `src/webview/`. `src/extension.ts` is the entry point; `jsonlEditorProvider.ts` and `jsonlDocument.ts` are the core of the Custom Editor. Shared types are in `src/types.ts`, styles in `media/`, and the build script is `scripts/esbuild.mjs`. Tests go in `test/suite/*.test.ts`; fixtures go in `test/fixtures/`. Do not edit `dist/` or `*.vsix` directly—they are build outputs.

## Build, Test, and Development Commands
Install dependencies with `npm install`. Main commands:

- `npm run compile`: Build the extension and Webview with esbuild into `dist/`.
- `npm run watch`: Watch mode for development rebuilds.
- `npm test`: Run `test/suite/**/*.test.ts` with Vitest.
- `npm run package`: Produce a distributable `.vsix` with `vsce package`.

For local checks, use `npm run watch` together with VS Code’s Extension Development Host.

## Coding Style & Naming Conventions
TypeScript, 2-space indent, semicolons, single-quoted strings—match existing code. Keep filenames in lowerCamelCase (e.g. `jsonlParser.ts`, `subtableRenderer.ts`). Use `PascalCase` for classes and types, `camelCase` for functions and variables, and `UPPER_SNAKE_CASE` for constants. Keep Webview logic inside `src/webview/`; do not mix it with extension-host code.

## Testing Guidelines
Tests use Vitest. Add new tests as `*.test.ts` under `test/suite/` next to the module they cover—for example `test/suite/jsonlSerializer.test.ts` for `src/jsonlSerializer.ts`. For parser/serializer checks, add small reusable JSONL samples under `test/fixtures/`. Run `npm test` before and after changes; for bug fixes, add at least one regression test.

## Commit & Pull Request Guidelines
History favors Conventional Commits (`chore:`, `refactor:`, etc.). Prefer `feat:`, `fix:`, `refactor:`, and `chore:`; keep subject lines short and in English. PRs must state the goal, main changes, and test results. If the Webview UI changed, add a screenshot or brief usage note and say whether JSONL edit/save/Undo/Redo behavior is affected.

## Release & Data Handling Tips
Before release, align versions in `package.json` and `CHANGELOG.md`, then run `npm run compile` and `npm run package`. `data/` may hold validation samples—do not add real or sensitive data. When changing large-file behavior, manually verify that chunked loading, search, and subtable expansion stay responsive.
