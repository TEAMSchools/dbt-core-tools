# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A VS Code extension wrapping dbt Core CLI. No LSP, no framework — six features: command runner, compiled SQL viewer, lineage viewer, jump-to-properties/model, model preview, and manifest-based navigation/autocomplete. Published to the VS Code marketplace under the `TEAMSchools` publisher.

Design spec: `docs/specs/2026-04-02-dbt-core-tools-vscode-extension-design.md`
Implementation plan: `docs/plans/2026-04-03-dbt-core-tools-vscode-extension.md`
v0.0.3 feedback spec: `docs/specs/2026-04-05-v0.0.3-feedback-design.md`
v0.0.3 feedback plan: `docs/plans/2026-04-05-v0.0.3-feedback.md`
v0.0.4 feedback spec: `docs/specs/2026-04-05-v0.0.4-feedback-design.md`
v0.0.4 feedback plan: `docs/plans/2026-04-05-v0.0.4-feedback.md`
v0.0.5 feedback spec: `docs/specs/2026-04-06-v0.0.5-feedback-design.md`
v0.0.5 feedback plan: `docs/plans/2026-04-06-v0.0.5-feedback.md`

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

To debug the extension: press F5 in VS Code (launch config in `.vscode/launch.json`).

## Architecture

**Entry point:** `src/extension.ts` — `activate()` / `deactivate()` hooks.

**Module layout:**

- `src/core/` — Project discovery, manifest reading/caching/watching, command execution (Task API), profiles parsing
- `src/commands/` — Command handlers (lifecycle, model commands, options picker, stage external sources)
- `src/statusbar/` — Target selector, defer toggle, manifest status indicator
- `src/features/` — Compiled SQL provider, parse-on-save, properties toggle, column sync, definition/hover/completion providers, lineage webview, preview webview
- `src/utils/` — Regex patterns for ref/source/macro extraction

**Build:** esbuild produces two bundles: `src/extension.ts` → `dist/extension.js` (CJS, node platform, `vscode` external) and `src/features/lineage/webview/App.tsx` → `dist/lineage.js` + `dist/lineage.css` (IIFE, browser platform, JSX automatic). See `esbuild.js`.

**Extension activation:** Triggered by `workspaceContains:**/dbt_project.yml`. Projects discovered via `workspace.findFiles`, filtering out `dbt_packages/` and `dbt_modules/`. Manifests loaded lazily per project on first editor focus.

**Shared state:** `src/extension.ts` owns module-level `_discovery` and `_activeProject`. Other modules access these via exported `getDiscovery()` and `getActiveProject()`. Commands and features import these getters — they never import `ProjectDiscovery` or `DbtProject` directly from core modules to access runtime state.

## Key Conventions

- TypeScript strict mode enabled
- Zero runtime dependencies — everything bundled via esbuild
- `vscode` module is external (provided by VS Code runtime)
- Preview webview uses plain HTML/JS; lineage webview uses React Flow (`@xyflow/react`) + dagre, bundled by esbuild to `dist/lineage.js`
- Extension depends on `redhat.vscode-yaml` for YAML schema validation
- Extension depends on `samuelcolvin.jinjahtml` for Jinja-SQL syntax highlighting
- Settings are namespaced under `dbtCoreTools.*`
- Linting/formatting via Trunk (prettier, markdownlint, osv-scanner, trufflehog)
- `vscode` is lazy-loaded via `require('vscode')` inside functions (not top-level imports) in core modules — this allows unit tests to run without the VS Code runtime
- If a module already has a top-level `import * as vscode` or other static imports, don't use lazy require for additional imports in that module (e.g. `modelCommands.ts` statically imports from `../extension`)
- Command execution uses VS Code Task API (`ShellExecution` + `onDidEndTaskProcess`) for reliable completion detection — `initExecutor(context)` must be called in `activate()`
- Webview postMessage requires a ready handshake — webview posts `{ type: "ready" }` after scripts load; extension buffers messages until ready
- Lineage webview has three message types: `updateCenter` (respects lock toggle), `resetCenter` (bypasses lock, used by reset button), and `mergeGraph` (adds nodes/edges for expand). Lock defaults to on.
- Background dbt processes are tracked via module-level maps (`_runningParses`, `_runningCompiles` in `parseOnSave.ts`) — cancel existing processes before spawning new ones for the same project/model
- Tests use `ts-node/register/transpile-only` (not `ts-node/register`) — required for Node 22 + TypeScript 6
- `tsconfig.test.json` extends `tsconfig.json` and includes `test/` — use it for type-checking tests
- Preview webview assets (HTML/JS/CSS in `src/features/preview/webview/`) are NOT bundled by esbuild — served at runtime via `webview.asWebviewUri()`. Lineage webview is bundled to `dist/` but its `index.html` and `styles.css` are still served from source.
- `.vscodeignore` excludes `src/**` but un-excludes `!src/features/*/webview/**` — any new webview directories need the same exception
- Tests for modules that statically import `vscode` need a stub: use `Module._resolveFilename` to redirect `vscode` to a minimal shim before importing the module under test (see `test/unit/modelCommands.test.ts` for the pattern)
- `resolveWorkspacePath(path, wsRoot)` in `modelCommands.ts` resolves relative config paths to absolute — use it instead of inline `path.isAbsolute`/`path.resolve` when reading `profilesDir` or similar settings
- `resolveDbtExecutable(dbtCommand, projectDir)` in `executor.ts` auto-detects `.venv/bin/dbt` when `dbtCommand` is default `"dbt"` — use `getCommandOptions()` which calls this automatically
- Lineage and preview panels are `WebviewViewProvider`s in separate Panel containers (`dbtLineagePanel`, `dbtPreviewPanel`). Preview provider is wired via `setPreviewProvider()` from `extension.ts`. All `WebviewViewProvider`s must register `onDidDispose` to reset `_view`, `_ready`, and pending message state.
- Preview panel uses a generation counter (`_generation`) to discard stale `dbt show` results when the user triggers multiple previews before the first completes
- Completion trigger characters in `extension.ts` (`registerCompletionItemProvider`) must match every prefix pattern in `completion.ts` — adding a pattern like `/\{%-?\s*$/` without registering `"%"` as a trigger character makes it unreachable except via manual Ctrl+Space
- Preview panel buffers messages as a queue (`_pendingMessages[]`) because `showPreview()` posts loading then results before the webview may be ready; lineage panel uses a single slot (`_pendingMessage`) since it only ever has one pending state

## dbt-Specific Gotchas

- `dbt parse` does NOT populate `compiled_code` in manifest — use `dbt compile` for that
- `profile:` key in `dbt_project.yml` can differ from `name:` — use `project.profileName` for profiles.yml lookup
- Package macro `original_file_path` is relative to the package dir, not project root — resolve via `dbt_packages/<pkg>/<path>`
- `dbt parse` and `dbt compile` both write to `manifest.json` — never run them concurrently; use `waitForParse(projectName)` from `parseOnSave.ts` before spawning compile
- Manifest file watcher is debounced (500ms) to avoid reading partial writes — transient JSON parse errors are logged as `[warn]` not `[error]`
