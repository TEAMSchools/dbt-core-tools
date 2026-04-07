# CLAUDE.md

## What This Is

A VS Code extension wrapping dbt Core CLI. No LSP, no framework — six features: command runner, compiled SQL viewer, lineage viewer, jump-to-properties/model, model preview, and manifest-based navigation/autocomplete.

Design specs and implementation plans live in `docs/specs/` and `docs/plans/`, named by date and topic.

## Build & Test Commands

```bash
npm run build          # Bundle with esbuild → dist/extension.js
npm run watch          # Build + watch for changes
npm run test           # Run unit tests (mocha + ts-node)
npm run package        # Create .vsix package
```

To package as VSIX for manual install:

```bash
npx @vscode/vsce package --allow-missing-repository
```

To run a single test file:

```bash
npx mocha test/unit/someFile.test.ts --require ts-node/register/transpile-only
```

## Architecture

**Entry point:** `src/extension.ts` — `activate()` / `deactivate()` hooks.

**Build:** esbuild produces two bundles: `src/extension.ts` → `dist/extension.js` (CJS, node platform, `vscode` external) and `src/features/lineage/webview/App.tsx` → `dist/lineage.js` + `dist/lineage.css` (IIFE, browser platform, JSX automatic). See `esbuild.js`.

**Shared state:** `src/extension.ts` owns module-level `_discovery` and `_activeProject`. Other modules access these via exported `getDiscovery()` and `getActiveProject()`. Commands and features import these getters — they never import `ProjectDiscovery` or `DbtProject` directly from core modules to access runtime state.

## Key Conventions

- No unbundled runtime dependencies — all deps (@xyflow/react, react, @vscode/codicons) are bundled by esbuild
- `vscode` module is external (provided by VS Code runtime)
- `vscode` is lazy-loaded via `require('vscode')` inside functions (not top-level imports) in core modules — this allows unit tests to run without the VS Code runtime
- If a module already has a top-level `import * as vscode` or other static imports, don't use lazy require for additional imports in that module (e.g. `modelCommands.ts` statically imports from `../extension`)
- Webview postMessage requires a ready handshake — webview posts `{ type: "ready" }` after scripts load; extension buffers messages until ready
- Background dbt processes are tracked via module-level maps (`_runningParses`, `_runningCompiles` in `parseOnSave.ts`) — cancel existing processes before spawning new ones for the same project/model
- Tests use `ts-node/register/transpile-only` (not `ts-node/register`) — required for Node 22 + TypeScript 6
- Preview webview assets (HTML/JS/CSS in `src/features/preview/webview/`) are NOT bundled by esbuild — served at runtime via `webview.asWebviewUri()`. Lineage webview is bundled to `dist/` but its `index.html` and `styles.css` are still served from source.
- `.vscodeignore` excludes `src/**` but un-excludes `!src/features/*/webview/**` — any new webview directories need the same exception
- Tests for modules that statically import `vscode` need a stub: use `Module._resolveFilename` to redirect `vscode` to a minimal shim before importing the module under test (see `test/unit/modelCommands.test.ts` for the pattern)
- Completion trigger characters in `extension.ts` (`registerCompletionItemProvider`) must match every prefix pattern in `completion.ts` — adding a pattern like `/\{%-?\s*$/` without registering `"%"` as a trigger character makes it unreachable except via manual Ctrl+Space

### Lineage Viewer

- Stateless graph: every update is a full `resetCenter` rebuild — no incremental state
- Message protocol: `resetCenter` (extension→webview, full rebuild), `changeView` (webview→extension, mode/depth change)
- View modes: `nn` (upstream+downstream), `upstream`, `downstream` with configurable depth
- Dagre layout via `@dagrejs/dagre` — single `layoutGraph` function, no incremental layout
- Editor changes debounced (150ms) before triggering `updateCenter`
- `ViewMode` type is defined separately in `lineagePanel.ts` and `webview/types.ts` — keep in sync
- Codicons require: `@vscode/codicons` dep, `loader: { ".ttf": "file" }` in esbuild, `font-src {{cspSource}} data:;` in CSP
- Target stored in-memory (not settings) — `getSelectedTarget()`/`setSelectedTarget()` from `targetSelector.ts`
- Compiled SQL fast path: parse-on-save skips `dbt parse` when compiled SQL panel is open, goes straight to `dbt compile`

## dbt-Specific Gotchas

- `dbt parse` does NOT populate `compiled_code` in manifest — use `dbt compile` for that
- `profile:` key in `dbt_project.yml` can differ from `name:` — use `project.profileName` for profiles.yml lookup
- Package macro `original_file_path` is relative to the package dir, not project root — resolve via `dbt_packages/<pkg>/<path>`
- `dbt parse` and `dbt compile` both write to `manifest.json` — never run them concurrently; use `waitForParse(projectName)` from `parseOnSave.ts` before spawning compile
- Manifest file watcher is debounced (500ms) to avoid reading partial writes — transient JSON parse errors are logged as `[warn]` not `[error]`
