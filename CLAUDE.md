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

**Shared state:** `src/extension.ts` owns module-level `_discovery`, `_activeProject`, and `_compiledSqlProvider`. Other modules access these via exported `getDiscovery()`, `getActiveProject()`, and `getCompiledSqlProvider()`. Commands and features import these getters — they never import `ProjectDiscovery` or `DbtProject` directly from core modules to access runtime state.

**Manifest loading is lazy:** `ensureLoaded()` is fire-and-forget (`void`) from `updateContextKeys` — any feature that reads manifest data on demand must `await project.ensureLoaded()` first, or it may see an empty manifest on first activation

**Command options:** All code that builds dbt commands must use `getCommandOptions(projectName)` from `modelCommands.ts` to get `dbtCommand`, `target`, `profilesDir`, and `deferState`. Never read these from config manually — that misses the selected target and defer toggle state.

**Executor cwd difference:** `executeInTerminal` defaults to workspace root when no `cwd` is passed; `executeAndCapture` takes an explicit `cwd` (typically `project.rootPath`). `resolveDbtExecutable` resolves relative paths to absolute so commands work in both contexts.

**Terminal execution:** `executeInTerminal(command, projectName, cwd?)` runs commands via VS Code `ShellExecution`. Always pass `project.rootPath` as `cwd` — without it, the shell runs from the workspace root, which breaks adapters that resolve relative paths (e.g. DuckDB `profiles.yml` `path`).

## Key Conventions

- No unbundled runtime dependencies — all deps (@xyflow/react, @dagrejs/dagre, react, @vscode/codicons) are bundled by esbuild
- `vscode` module is external (provided by VS Code runtime)
- `vscode` is lazy-loaded via `require('vscode')` inside functions (not top-level imports) in core modules — this allows unit tests to run without the VS Code runtime
- If a module already has a top-level `import * as vscode` or other static imports, don't use lazy require for additional imports in that module (e.g. `modelCommands.ts` statically imports from `../extension`)
- Webview postMessage requires a ready handshake — webview posts `{ type: "ready" }` after scripts load; extension buffers messages until ready
- Background dbt compile processes are tracked via `_runningCompiles` in `compileOnSave.ts` — cancel existing processes before spawning new ones for the same model
- Tests use `ts-node/register/transpile-only` (not `ts-node/register`) — required for Node 22 + TypeScript 6
- Tests using `Module._resolveFilename` vscode stubs (completion, modelCommands, etc.) may fail intermittently on Node 22 due to ESM resolution caching — if `npm test` fails but individual non-stub tests pass, this is a known issue
- Preview webview assets (HTML/JS/CSS in `src/features/preview/webview/`) are NOT bundled by esbuild — served at runtime via `webview.asWebviewUri()`. Lineage webview is bundled to `dist/` but its `index.html` and `styles.css` are still served from source.
- `.vscodeignore` excludes `src/**` but un-excludes `!src/features/*/webview/**` — any new webview directories need the same exception
- Tests for modules that statically import `vscode` need a stub: use `Module._resolveFilename` to redirect `vscode` to a minimal shim before importing the module under test (see `test/unit/modelCommands.test.ts` for the pattern)
- Completion trigger characters in `extension.ts` (`registerCompletionItemProvider`) must match every prefix pattern in `completion.ts` — adding a pattern like `/\{%-?\s*$/` without registering `"%"` as a trigger character makes it unreachable except via manual Ctrl+Space
- In Codespaces, open URLs via `python3 -m http.server <port>` — ports auto-forward when a process listens; the forwarded URL is `https://<codespace-name>-<port>.app.github.dev/`
- VS Code IPC socket (`$VSCODE_IPC_HOOK_CLI`) accepts `openExternal` with `uris` array but opens new windows — there is no reliable way to open Simple Browser programmatically from CLI

### Lineage Viewer

- Stateless graph: every update is a full `resetCenter` rebuild — no incremental state
- Message protocol: `resetCenter` (extension→webview, full rebuild + `maxDepth`), `changeView` (webview→extension, mode/depth change), `buildVisible` (webview→extension, build selected nodes)
- View modes: `nn` (upstream+downstream), `upstream`, `downstream` with configurable depth
- Depth `0` = "All" (show entire reachable graph) — extension converts to `Infinity` for `buildGraphData`; `maxDepth` must always be computed so the UI can step back from "All"
- Dagre layout via `@dagrejs/dagre` — single `layoutGraph` function, no incremental layout
- Dagre handles all node positioning — avoid post-processing overrides for sibling groups (staggered multi-column was tried and reverted due to edge routing conflicts)
- Editor changes debounced (150ms) before triggering `updateCenter`
- `findNodeByFilePath` checks both `original_file_path` and `patch_path` — opening a `.yml` properties file keeps the lineage centered on the model
- Depth minus button works from "All" (converts to maxDepth, then subtracts); plus is disabled at "All" since it already shows everything — "All" is also a separate toggle button
- `_pendingCenterId` bridges node clicks and the debounced `updateCenter` — when `openFile` opens a file from a graph click, the clicked node ID is preserved as the center; without this, `_getActiveNodeId` re-resolves from the file path and can match the wrong node (e.g. a model via `patch_path` when a source was clicked, since sources and models can share `.yml` files)
- `ViewMode` type is defined separately in `lineagePanel.ts` and `webview/types.ts` — keep in sync
- React Flow `fitView` prop only fires on mount — after data changes, call `fitView()` explicitly via `requestAnimationFrame`
- Codicons require: `@vscode/codicons` dep, `loader: { ".ttf": "file" }` in esbuild, `font-src {{cspSource}} data:;` in CSP
- Target stored in-memory (not settings) — `getSelectedTarget()`/`setSelectedTarget()` from `targetSelector.ts`
- Compiled SQL uses a single fixed URI (`dbt-compiled:compiled.sql`) with provider-owned state — `CompiledSqlProvider.setModel()` updates which model is shown; the panel follows the active editor automatically
- `vscode.languages.setTextDocumentLanguage()` fires `onDidCloseTextDocument` then `onDidOpenTextDocument` — any close handler for virtual documents must guard against this (e.g. defer `clearModel()` and recheck)
- `provideTextDocumentContent` is synchronous — it cannot await `ensureLoaded()`; manifest must be loaded before `setModel()` fires the change event
- Compiled SQL provider is module-level state accessed via `getCompiledSqlProvider()` — features that open files (e.g. lineage `openFile`) must call `setModel()` directly; `onDidChangeActiveTextEditor` is unreliable when `showTextDocument` is called from webview message handlers
- Compile-on-save runs `dbt compile -s <model>` on every .sql save — compile is a superset of parse (updates full manifest + populates `compiled_code`); compile `close` handler reloads manifest directly (bypasses file-watcher debounce)
- `CompiledSqlProvider.isOpen` is derived from internal state — reset via `clearModel()` when the virtual document closes; `onDidCloseTextDocument` in `extension.ts` handles this
- All lineage CSS uses VS Code theme variables (`--vscode-editor-background`, `--vscode-widget-border`, etc.) with hardcoded fallbacks — don't introduce new hardcoded colors
- Node fill colors are derived from `BORDER_MAP` color + `"BF"` suffix (75% opacity) — no separate `FILL_MAP`
- Toolbar icon buttons share `.toolbar-icon-btn` base class — use it for new toolbar buttons

### Model Preview

- `PreviewViewProvider` uses `_ensureView()` to guarantee the webview is visible and ready before posting messages — if the view was disposed, it programmatically focuses via `executeCommand("dbtCoreTools.previewView.focus")` and waits for the `ready` handshake
- Preview webview layout uses flexbox (`body` → `#content` → `.table-container`) to keep horizontal/vertical scrollbars within the visible panel area — don't remove height constraints or the scrollbar moves off-screen

## dbt-Specific Gotchas

- `dbt parse` does NOT populate `compiled_code` in manifest — use `dbt compile` for that
- `dbt build` only populates `compiled_code` for models it actually executes — skipped/cached models get empty `compiled_code`; use `dbt compile` (no selector) to populate all models
- `dbt show` default (table) output truncates wide results with `...` columns — use `--output json` to get all columns
- `profile:` key in `dbt_project.yml` can differ from `name:` — use `project.profileName` for profiles.yml lookup
- Package macro `original_file_path` is relative to the package dir, not project root — resolve via `dbt_packages/<pkg>/<path>`
- `dbt compile -s <model>` rewrites the entire `manifest.json` — only the selected model gets `compiled_code`; all other models lose theirs
- `dbt parse` and `dbt compile` both write to `manifest.json` — never run them concurrently
- `dbt compile` with `--defer` still resolves `ref()` using the current target's schema — defer only affects execution (skipping upstream models), not compiled SQL output
- Manifest file watcher is debounced (500ms) to avoid reading partial writes — transient JSON parse errors are logged as `[warn]` not `[error]`
- Source `original_file_path` points to the `.yml` defining the source — multiple sources (and model `patch_path` entries) can share the same `.yml`, so file-path-based lookups are ambiguous for sources
- `_propertiesToSql` in `properties.ts` uses indent-aware backward search — `- name:` entries exist at multiple YAML levels (models, columns, source tables); the walk tracks minimum indentation to find the resource-level name, not a nested column name
- `patch_path` format is `"project_name://relative/path.yml"` — use `parsePatchPath()` from `src/utils/paths.ts` to extract the relative path; don't inline the parsing
- Use `modelNameFromPath()` from `src/utils/paths.ts` to extract model name from a file path — don't inline the `split/pop/replace` pattern

### Test dbt Project

A minimal Jaffle Shop project lives at `test/fixtures/test_project/` (DuckDB adapter). Setup: `cd test/fixtures/test_project && dbt deps && dbt build && dbt compile && cp target/manifest.json defer_manifest/manifest.json`. Requires `dbt-core` and `dbt-duckdb` in a Python venv (Codespaces has no system pip — use `uv`).
