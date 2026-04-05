# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A VS Code extension wrapping dbt Core CLI. No LSP, no framework — six features: command runner, compiled SQL viewer, lineage viewer, jump-to-properties/model, model preview, and manifest-based navigation/autocomplete. Published to the VS Code marketplace under the `TEAMSchools` publisher.

Design spec: `docs/specs/2026-04-02-dbt-core-tools-vscode-extension-design.md`
Implementation plan: `docs/plans/2026-04-03-dbt-core-tools-vscode-extension.md`
v0.0.3 feedback spec: `docs/specs/2026-04-05-v0.0.3-feedback-design.md`
v0.0.3 feedback plan: `docs/plans/2026-04-05-v0.0.3-feedback.md`

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

**Build:** esbuild bundles `src/extension.ts` → single `dist/extension.js` (CJS, node platform, `vscode` external).

**Extension activation:** Triggered by `workspaceContains:**/dbt_project.yml`. Projects discovered via `workspace.findFiles`, filtering out `dbt_packages/` and `dbt_modules/`. Manifests loaded lazily per project on first editor focus.

**Shared state:** `src/extension.ts` owns module-level `_discovery` and `_activeProject`. Other modules access these via exported `getDiscovery()` and `getActiveProject()`. Commands and features import these getters — they never import `ProjectDiscovery` or `DbtProject` directly from core modules to access runtime state.

## Key Conventions

- TypeScript strict mode enabled
- Zero runtime dependencies — everything bundled via esbuild
- `vscode` module is external (provided by VS Code runtime)
- Webview views use plain HTML/JS (no React/Svelte) with D3.js + dagre (vendored locally, no CDN — extension runs in Codespaces)
- Extension depends on `redhat.vscode-yaml` for YAML schema validation
- Extension depends on `samuelcolvin.jinjahtml` for Jinja-SQL syntax highlighting
- Settings are namespaced under `dbtCoreTools.*`
- Linting/formatting via Trunk (prettier, markdownlint, osv-scanner, trufflehog)
- `vscode` is lazy-loaded via `require('vscode')` inside functions (not top-level imports) in core modules — this allows unit tests to run without the VS Code runtime
- If a module already has a top-level `import * as vscode` or other static imports, don't use lazy require for additional imports in that module (e.g. `modelCommands.ts` and `previewPanel.ts` statically import from `../extension`)
- Command execution uses VS Code Task API (`ShellExecution` + `onDidEndTaskProcess`) for reliable completion detection — `initExecutor(context)` must be called in `activate()`
- Webview postMessage requires a ready handshake — webview posts `{ type: "ready" }` after scripts load; extension buffers messages until ready
- Tests use `ts-node/register/transpile-only` (not `ts-node/register`) — required for Node 22 + TypeScript 6
- `tsconfig.test.json` extends `tsconfig.json` and includes `test/` — use it for type-checking tests
- Webview assets (HTML/JS/CSS in `src/features/*/webview/`) are NOT bundled by esbuild — they're served at runtime via `webview.asWebviewUri()` and must be included in the VSIX
- `.vscodeignore` excludes `src/**` but un-excludes `!src/features/*/webview/**` — any new webview directories need the same exception

## dbt-Specific Gotchas

- `dbt parse` does NOT populate `compiled_code` in manifest — use `dbt compile` for that
- `profile:` key in `dbt_project.yml` can differ from `name:` — use `project.profileName` for profiles.yml lookup
- Package macro `original_file_path` is relative to the package dir, not project root — resolve via `dbt_packages/<pkg>/<path>`
- `dbt parse` and `dbt compile` both write to `manifest.json` — never run them concurrently; compile must wait for parse to finish
