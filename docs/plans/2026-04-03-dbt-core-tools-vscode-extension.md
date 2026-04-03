# dbt Core Tools VS Code Extension — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a VS Code extension that wraps dbt Core CLI with project
discovery, command running, compiled SQL viewing, lineage visualization,
properties navigation, model preview, and manifest-based code intelligence.

**Architecture:** Standalone TypeScript extension with a core layer (project
discovery, manifest reading, command execution) and six feature modules layered
on top. Webview panels for lineage (D3.js/dagre) and model preview (HTML table).
All manifest-dependent features react to a shared `FileSystemWatcher`.

**Tech Stack:** TypeScript, VS Code Extension API (`^1.85.0`), esbuild, D3.js,
dagre, Mocha + `@vscode/test-electron`

**Spec:**
`docs/superpowers/specs/2026-04-02-dbt-core-tools-vscode-extension-design.md`

---

## Repository Setup

The extension lives in a **standalone repository** (not inside the teamster
monorepo). The plan creates it at a sibling path. After Task 1, all subsequent
work happens in the new repo.

**New repository:** `dbt-core-tools` **GitHub org:** `TEAMSchools` (same as
teamster)

---

## File Structure

```text
dbt-core-tools/
├── .vscode/
│   ├── launch.json              # Extension debug launch config
│   └── tasks.json               # Build tasks
├── src/
│   ├── extension.ts             # activate/deactivate entry point
│   ├── core/
│   │   ├── project.ts           # DbtProject class (one per discovered project)
│   │   ├── discovery.ts         # Find dbt projects in workspace
│   │   ├── manifest.ts          # Read/cache/watch manifest.json
│   │   ├── executor.ts          # Run dbt commands, manage concurrency
│   │   └── profiles.ts          # Parse profiles.yml for targets
│   ├── commands/
│   │   ├── lifecycle.ts         # setup, deps, parse, clean, debug, retry
│   │   ├── modelCommands.ts     # run, build, test, show
│   │   ├── optionsPicker.ts     # canPickMany quick pick (scope + full refresh)
│   │   └── stageExternal.ts     # stage_external_sources with source() parsing
│   ├── statusbar/
│   │   ├── targetSelector.ts    # Target quick pick + status bar item
│   │   ├── deferToggle.ts       # Defer on/off status bar item
│   │   └── manifestStatus.ts    # Manifest timestamp + running indicator
│   ├── features/
│   │   ├── compiledSql.ts       # TextDocumentContentProvider for compiled SQL
│   │   ├── parseOnSave.ts       # Save listener -> dbt parse with debounce
│   │   ├── properties.ts        # Toggle SQL/Properties, scaffold YAML
│   │   ├── columnSync.ts        # Sync columns command + description propagation
│   │   ├── definition.ts        # DefinitionProvider for ref/source/macro
│   │   ├── hover.ts             # HoverProvider showing upstream columns
│   │   ├── completion.ts        # CompletionItemProvider for ref/source/macro
│   │   ├── lineage/
│   │   │   ├── lineagePanel.ts  # Webview panel lifecycle + messaging
│   │   │   └── webview/
│   │   │       ├── index.html   # Webview shell
│   │   │       ├── main.js      # D3/dagre graph rendering
│   │   │       └── styles.css   # Node styling, context menu
│   │   └── preview/
│   │       ├── previewPanel.ts  # Webview panel for dbt show results
│   │       └── webview/
│   │           ├── index.html   # Table shell
│   │           ├── main.js      # Sortable table + error display
│   │           └── styles.css   # Table styling
│   └── utils/
│       └── patterns.ts          # Regex for ref(), source(), macro extraction
├── test/
│   ├── fixtures/
│   │   ├── manifest.json        # Minimal valid manifest for tests
│   │   └── profiles.yml         # Test profiles
│   ├── unit/
│   │   ├── patterns.test.ts     # Pattern matching tests
│   │   ├── manifest.test.ts     # Manifest parsing tests
│   │   ├── discovery.test.ts    # Project discovery tests
│   │   ├── profiles.test.ts     # Profiles parsing tests
│   │   ├── executor.test.ts     # Command building tests
│   │   ├── properties.test.ts   # Scaffold/sync tests
│   │   └── optionsPicker.test.ts # Selector building tests
│   └── runTest.ts               # Test runner entry point
├── package.json
├── tsconfig.json
├── esbuild.js
├── .vscodeignore
├── .gitignore
└── README.md
```

---

## Task 1: Scaffold the Extension Project

**Files:**

- Create: `package.json`, `tsconfig.json`, `esbuild.js`, `.vscodeignore`,
  `.gitignore`, `.vscode/launch.json`, `.vscode/tasks.json`, `src/extension.ts`,
  `test/runTest.ts`

- [ ] **Step 1: Create the repository and initialize**

```bash
mkdir -p /workspaces/dbt-core-tools
cd /workspaces/dbt-core-tools
git init
npm init -y
```

- [ ] **Step 2: Install dev dependencies**

```bash
npm install --save-dev \
  @types/vscode@^1.85.0 \
  @types/mocha \
  @types/node \
  @vscode/test-electron \
  esbuild \
  mocha \
  typescript \
  @vscode/vsce
```

- [ ] **Step 3: Write `package.json`**

Replace the generated `package.json` with the full extension manifest. This is
the single source of truth for all commands, menus, settings, and activation.

The `package.json` must include:

- `activationEvents`: `["workspaceContains:**/dbt_project.yml"]`
- `extensionDependencies`: `["redhat.vscode-yaml"]`
- All commands from the spec (lifecycle + model + feature commands)
- `editor/title` menus with submenus for Run, Build, Test
- `editor/context` menus for Run, Build, Test, Show
- All 8 configuration properties from the spec
- `yamlValidation` entries for `dbt_project.yml`, `selectors.yml`,
  `packages.yml` pointing to `dbt-labs/dbt-jsonschema` (pinned version)

The `yamlValidation` URLs should reference `github.com/dbt-labs/dbt-jsonschema`
— verify the correct tag for dbt 1.11.x. The general dbt YAML schema
(`dbt_yml_files`) cannot be contributed via `yamlValidation` for "all other .yml
files" — that requires programmatic registration via the YAML extension API at
activation time (handled in Task 6).

Context keys for menu visibility:

- `dbtCoreTools.isDbtSqlFile` — `.sql` file inside a discovered dbt project
- `dbtCoreTools.isDbtFile` — `.sql` or `.yml` file inside a discovered project
- `dbtCoreTools.isDbtSqlFileWithSources` — `.sql` file containing `source()`

- [ ] **Step 4: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2022",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test"]
}
```

- [ ] **Step 5: Write `esbuild.js`**

Standard VS Code extension esbuild config: entry point `src/extension.ts`,
bundle to `dist/extension.js`, `vscode` as external, CJS format, Node platform.
Support `--production` (minify, no sourcemap) and `--watch` flags.

- [ ] **Step 6: Write `.vscode/launch.json` and `.vscode/tasks.json`**

Standard Extension Host debug config pointing to `dist/extension.js` with a
`npm: build` pre-launch task.

- [ ] **Step 7: Write minimal `src/extension.ts`**

```typescript
import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext): void {
  console.log("dbt Core Tools activated");
}

export function deactivate(): void {
  // cleanup
}
```

- [ ] **Step 8: Write `.vscodeignore` and `.gitignore`**

`.vscodeignore`: exclude `src/`, `test/`, `.vscode/`, `node_modules/`, config
files. `.gitignore`: `node_modules/`, `dist/`, `*.vsix`.

- [ ] **Step 9: Build and verify**

```bash
npm run build
```

Expected: `dist/extension.js` created with no errors.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: scaffold dbt-core-tools extension project"
```

---

## Task 2: Core — Pattern Utilities

Regex patterns for extracting `ref()`, `source()`, and macro references from SQL
files. These are used by multiple features (definition, hover, completion, stage
external sources).

**Files:**

- Create: `src/utils/patterns.ts`
- Test: `test/unit/patterns.test.ts`

- [ ] **Step 1: Write the failing tests**

Test the following functions:

- `extractRef(text)` — extracts model name from single/double-quoted `ref()`
  calls, returns `null` for non-refs, handles whitespace
- `extractSource(text)` — extracts `{sourceName, tableName}` from `source()`
  calls
- `extractSourceCalls(sql)` — extracts all `source()` calls from a SQL string
  (used by Stage External Sources)
- `findRefAtPosition(line, character)` — returns model name when cursor is
  inside a `ref()` on the given line, `null` otherwise
- `findSourceAtPosition(line, character)` — same for `source()` calls

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx mocha test/unit/patterns.test.ts --require ts-node/register
```

Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `src/utils/patterns.ts`**

Use non-global `RegExp` for single-match functions, global `RegExp` with
`exec()` loop for multi-match and position-based functions. Patterns:

- `REF_PATTERN`: `/ref\s*\(\s*['"]([^'"]+)['"]\s*\)/`
- `SOURCE_PATTERN`:
  `/source\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/`

Position-based functions iterate matches on the line and check if `character`
falls within the match span.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx mocha test/unit/patterns.test.ts --require ts-node/register
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/patterns.ts test/unit/patterns.test.ts
git commit -m "feat: add pattern utilities for ref/source extraction"
```

---

## Task 3: Core — DbtProject and Discovery

The `DbtProject` class represents one dbt project. Discovery finds all projects
in the workspace.

**Files:**

- Create: `src/core/project.ts`, `src/core/discovery.ts`
- Test: `test/unit/discovery.test.ts`

- [ ] **Step 1: Implement `src/core/project.ts`**

`DbtProject` class with:

- Constructor takes `projectYmlPath` and `{name}`. Derives `rootPath` and
  `manifestPath` (`target/manifest.json`).
- `ensureLoaded()` — lazy-loads manifest and starts `FileSystemWatcher`. Only
  called on first file open in this project.
- `reloadManifest()` — reads and parses `manifest.json`, fires
  `onManifestChanged` event.
- `getNodes()`, `getSources()`, `getMacros()`, `getChildMap()`, `getParentMap()`
  — typed accessors into manifest data.
- `findNodeByName(modelName)` — searches nodes by `name` field.
- `findNodeByFilePath(filePath)` — matches `original_file_path`.
- `containsFile(filePath)` — checks if a file path is under this project root.
- `getManifestMtime()` — returns manifest file mtime.

TypeScript interfaces for manifest structures:

- `ManifestNode`: `unique_id`, `resource_type`, `name`, `path`,
  `original_file_path`, `patch_path`, `compiled_code`, `depends_on`
  (`{macros: string[], nodes: string[]}`), `columns` (Record<string,
  ManifestColumn>), `contract` (`{enforced: boolean}`), `config`
- `ManifestColumn`: `name`, `description`, `data_type`, `meta`, `constraints`,
  `tags`
- `ManifestSource`: `unique_id`, `resource_type`, `source_name`, `name`,
  `identifier`, `path`, `original_file_path`, `columns`
- `ManifestMacro`: `unique_id`, `name`, `package_name`, `path`,
  `original_file_path`, `macro_sql`

- [ ] **Step 2: Implement `src/core/discovery.ts`**

`ProjectDiscovery` class with:

- `discover()` — uses `workspace.findFiles('**/dbt_project.yml')` or explicit
  `projectDirectories` setting. Filters out paths containing `/dbt_packages/` or
  `/dbt_modules/`. Extracts project name from `dbt_project.yml` via simple regex
  (`/^name:\s*['"]?([^\s'"]+)/m`) to avoid a YAML parser dependency.
- `findProjectForFile(filePath)` — returns the project with the longest matching
  root path (most specific match).
- `dispose()` — disposes all projects.

- [ ] **Step 3: Write tests for `DbtProject.containsFile`**

Test `containsFile` returns `true` for files inside the project root and `false`
for files outside. Test name extraction.

- [ ] **Step 4: Run tests**

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/project.ts src/core/discovery.ts test/unit/discovery.test.ts
git commit -m "feat: add DbtProject class and project discovery"
```

---

## Task 4: Core — Profiles Parser

Parse `profiles.yml` to extract available targets for the target selector.

**Files:**

- Create: `src/core/profiles.ts`
- Test: `test/unit/profiles.test.ts`, `test/fixtures/profiles.yml`

- [ ] **Step 1: Write test fixture**

`test/fixtures/profiles.yml` — a minimal profiles file with one profile
(`kipptaf`) containing `target: defer` and three outputs (`defer`, `dev`,
`prod`).

- [ ] **Step 2: Write the failing tests**

Test `parseProfileTargets(profilesPath, profileName)`:

- Extracts targets for a known profile (returns sorted list + default target)
- Returns empty for a missing profile name
- Returns empty for a missing file path

- [ ] **Step 3: Implement `src/core/profiles.ts`**

`parseProfileTargets(profilesPath, profileName)` returns
`{targets: string[], defaultTarget: string | null}`.

Uses line-based parsing (no YAML dependency): track indentation to find the
profile block, extract `target:` value, find `outputs:` block, collect keys at
the correct indent level.

- [ ] **Step 4: Run tests**

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/profiles.ts test/unit/profiles.test.ts test/fixtures/profiles.yml
git commit -m "feat: add profiles.yml parser for target extraction"
```

---

## Task 5: Core — Command Executor

Runs dbt commands in a terminal or captures output programmatically. Manages
one-command-per-project concurrency.

**Files:**

- Create: `src/core/executor.ts`
- Test: `test/unit/executor.test.ts`

- [ ] **Step 1: Write failing tests for command building**

Test `buildDbtCommand(options)` which takes `DbtCommandOptions`:

```typescript
interface DbtCommandOptions {
  dbtCommand: string;
  subcommand: string;
  projectDir: string;
  selector?: string;
  target?: string;
  profilesDir?: string;
  deferState?: string;
  fullRefresh?: boolean;
  vars?: string;
  args?: string;
  limit?: number;
}
```

Test cases:

- Basic: `dbt run -s my_model --project-dir=/ws`
- Custom command: `uv run dbt build -s +my_model+ --project-dir=/ws`
- With target: includes `--target=dev`
- With profiles-dir: includes `--profiles-dir=/custom`
- With defer: includes `--defer --state=/ws/target/prod`
- With full-refresh: includes `--full-refresh`
- Lifecycle (no selector): `dbt parse --project-dir=/ws`

- [ ] **Step 2: Run tests to verify they fail**

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/core/executor.ts`**

- `buildDbtCommand(options)` — pure function that builds a command string from
  options. Joins parts with spaces.
- `executeInTerminal(command, projectName)` — creates a VS Code terminal, sends
  the command. Tracks running commands per project in a
  `Map<string, Disposable>` to enforce one-at-a-time. Shows warning if busy.
- `executeAndCapture(command, cwd)` — runs a command via
  `child_process.execFile` (use shell-split to separate command and args for
  safety). Returns `{stdout, stderr, exitCode}`.

**Security note:** Use `child_process.execFile` with explicit args array instead
of `exec` with string interpolation to prevent injection. Split the command
string on spaces (respecting quotes) before passing to `execFile`.

- [ ] **Step 4: Run tests**

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/executor.ts test/unit/executor.test.ts
git commit -m "feat: add command executor with concurrency guard"
```

---

## Task 6: Core — Wire Up Extension Activation

Connect discovery to the extension entry point. Set context keys for menu
visibility. Register the YAML schema for dbt yml files programmatically.

**Files:**

- Modify: `src/extension.ts`

- [ ] **Step 1: Implement full activation**

Replace the minimal `extension.ts` with:

- Import and instantiate `ProjectDiscovery`, run `discover()`
- Track `activeProject` by listening to `onDidChangeActiveTextEditor` and
  calling `findProjectForFile`
- Set VS Code context keys (`setContext` command):
  - `dbtCoreTools.isDbtSqlFile` — true when active file is `.sql` in a project
  - `dbtCoreTools.isDbtFile` — true for `.sql` or `.yml` in a project
  - `dbtCoreTools.isDbtSqlFileWithSources` — true when `.sql` contains `source(`
- Lazy-load manifests: on `onDidChangeActiveTextEditor`, call
  `project.ensureLoaded()` for the active project
- Register YAML schema for `dbt_yml_files` via the Red Hat YAML extension's
  `registerContributor` API — contributes the schema URL for `.yml` files inside
  project dirs that aren't `dbt_project.yml`, `selectors.yml`, or `packages.yml`
- Export `getDiscovery()` and `getActiveProject()` for use by other modules

- [ ] **Step 2: Build and verify**

```bash
npm run build
```

Expected: Compiles with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/extension.ts
git commit -m "feat: wire up activation with discovery and context keys"
```

---

## Task 7: Feature 1 — Lifecycle Commands

Register setup, deps, parse, clean, debug, retry commands.

**Files:**

- Create: `src/commands/lifecycle.ts`
- Modify: `src/extension.ts` (register commands)

- [ ] **Step 1: Implement lifecycle commands**

`src/commands/lifecycle.ts` exports:

- `setupProject()` — runs `dbt deps && dbt parse` for active project
- `setupAllProjects()` — iterates all discovered projects, runs deps + parse for
  each sequentially in a single terminal
- `installDeps()` — `dbt deps`
- `parseProject()` — `dbt parse`
- `cleanProject()` — `dbt clean`
- `debugProject()` — `dbt debug`
- `retryProject()` — `dbt retry`

Each reads `dbtCommand` and `profilesDir` from settings. Uses
`buildDbtCommand` + `executeInTerminal`.

- [ ] **Step 2: Register commands in `src/extension.ts`**

Register all 7 lifecycle commands via `vscode.commands.registerCommand` in the
`activate` function. Push disposables to `context.subscriptions`.

- [ ] **Step 3: Build and verify**

```bash
npm run build
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/commands/lifecycle.ts src/extension.ts
git commit -m "feat: add lifecycle commands (setup, deps, parse, clean, debug, retry)"
```

---

## Task 8: Feature 1 — Options Picker and Model Commands

The `canPickMany` quick pick for scope + full refresh, and the
run/build/test/show commands.

**Files:**

- Create: `src/commands/optionsPicker.ts`, `src/commands/modelCommands.ts`
- Test: `test/unit/optionsPicker.test.ts`

- [ ] **Step 1: Write failing tests for selector building**

Test `buildSelector(modelName, {upstream, downstream})`:

- No options: `"my_model"`
- Upstream only: `"+my_model"`
- Downstream only: `"my_model+"`
- Both: `"+my_model+"`

- [ ] **Step 2: Run tests to verify they fail**

Expected: FAIL.

- [ ] **Step 3: Implement `src/commands/optionsPicker.ts`**

- `buildSelector(modelName, options)` — pure function, prepends/appends `+`
  based on flags
- `showOptionsPicker()` — presents `vscode.window.showQuickPick` with
  `canPickMany: true`, items: Full Refresh, Upstream, Downstream. Returns
  `{fullRefresh, upstream, downstream}` or `undefined` if cancelled.

- [ ] **Step 4: Implement `src/commands/modelCommands.ts`**

Helper: `getModelName()` — extracts model name from active `.sql` editor
filename (sans extension).

Helper: `getCommandOptions()` — reads `dbtCommand`, per-project `target`,
`profilesDir`, and defer state from settings and runtime toggle.

`runModelCommand(subcommand, withOptions)` — resolves model name and project,
optionally shows the options picker, builds and executes the command.

Exports: `runModel`, `runModelOptions`, `buildModel`, `buildModelOptions`,
`testModel`, `testModelOptions`, `showModel` (stub — implemented in Task 13).

- [ ] **Step 5: Register commands in `src/extension.ts`**

Register all model commands. Push to `context.subscriptions`.

- [ ] **Step 6: Run tests and build**

Expected: Tests PASS, build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/commands/optionsPicker.ts src/commands/modelCommands.ts test/unit/optionsPicker.test.ts src/extension.ts
git commit -m "feat: add model commands with options picker"
```

---

## Task 9: Feature 1 — Status Bar Items

Target selector, defer toggle, and manifest timestamp with running indicator.

**Files:**

- Create: `src/statusbar/targetSelector.ts`, `src/statusbar/deferToggle.ts`,
  `src/statusbar/manifestStatus.ts`
- Modify: `src/extension.ts`

- [ ] **Step 1: Implement `src/statusbar/targetSelector.ts`**

`TargetSelector` class:

- Creates a `StatusBarItem` (left-aligned, priority 100)
- `update(project)` — shows `"{projectName} | dbt: {target}"` or hides if no
  project. Tooltip: "Click to change dbt target".
- `selectTarget(project)` — reads `profilesDir` from settings, calls
  `parseProfileTargets`, shows quick pick of available targets, updates
  `dbtCoreTools.target` workspace setting for the project.

- [ ] **Step 2: Implement `src/statusbar/deferToggle.ts`**

`DeferToggle` class:

- Creates a `StatusBarItem` (left-aligned, priority 99)
- Maintains runtime defer state per project in a `Map<string, boolean>` (not
  persisted — defaults to `true` when `deferManifestPath` is configured)
- `update(project)` — shows `"defer: on/off/n/a"`. Tooltip explains defer in
  plain language.
- `toggle(project)` — flips state. If no manifest configured, opens settings.
- `isDeferred(projectName)` — returns current state (used by command builder).

- [ ] **Step 3: Implement `src/statusbar/manifestStatus.ts`**

`ManifestStatus` class:

- Creates a `StatusBarItem` (left-aligned, priority 98)
- `update(project)` — shows `"parsed: {time}"` from manifest mtime, or
  `"parsed: never"`. Tooltip shows full timestamp.
- `setRunning(label)` — temporarily shows `"$(sync~spin) dbt: {label}..."`.
- `clearRunning(project)` — reverts to timestamp display.
- Click command: `dbtCoreTools.parseProject`.

- [ ] **Step 4: Register in `src/extension.ts`**

Instantiate all three status bar classes. Call `updateStatusBar()` after each
active project change. Register `selectTarget` and `toggleDefer` commands. Push
all disposables.

- [ ] **Step 5: Build and verify**

```bash
npm run build
```

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/statusbar/ src/extension.ts
git commit -m "feat: add status bar items (target, defer, manifest)"
```

---

## Task 10: Feature 1 — Stage External Sources

**Files:**

- Create: `src/commands/stageExternal.ts`
- Modify: `src/extension.ts`

- [ ] **Step 1: Implement `src/commands/stageExternal.ts`**

`stageExternalSources()`:

- Gets active project and reads `stageExternalSourcesVars` from settings
- Interpolates `${projectName}` in var values using `project.name`
- If active editor is a `.sql` file, calls `extractSourceCalls()` to get source
  names, builds `--args 'select: src_a src_b'`
- If no editor context, stages all (no `--args`)
- Builds command via `buildDbtCommand` with
  `subcommand: "run-operation stage_external_sources"`, passes `--vars` and
  `--args`
- Executes in terminal

- [ ] **Step 2: Register in `src/extension.ts`**

Register `dbtCoreTools.stageExternalSources` command.

- [ ] **Step 3: Build and commit**

```bash
npm run build
git add src/commands/stageExternal.ts src/extension.ts
git commit -m "feat: add stage external sources command"
```

---

## Task 11: Feature 2 — Compiled SQL Viewer

**Files:**

- Create: `src/features/compiledSql.ts`, `src/features/parseOnSave.ts`
- Modify: `src/extension.ts`

- [ ] **Step 1: Implement `src/features/compiledSql.ts`**

`CompiledSqlProvider` implements `TextDocumentContentProvider`:

- Custom URI scheme: `dbt-compiled:`
- URI format:
  `dbt-compiled:modelName.compiled.sql?project=projectName&model=modelName`
- `provideTextDocumentContent(uri)` — extracts project and model from URI query
  params, finds the node in the manifest, returns `compiled_code` or a fallback
  message.
- `fireChange(uri)` — fires `onDidChange` event to refresh the virtual document.

`showCompiledSql(provider)`:

- Gets active project and model name from editor
- Creates the compiled URI and opens it in a side-by-side editor
  (`ViewColumn.Beside`, `preserveFocus: true`)
- Sets language to `sql`
- If node not found in manifest, triggers `dbtCoreTools.parseProject`

- [ ] **Step 2: Implement `src/features/parseOnSave.ts`**

`registerParseOnSave(context)`:

- Listens to `workspace.onDidSaveTextDocument`
- Only fires for `.sql` files when `parseOnSave` is enabled
- Finds the project for the saved file
- **Cancel in-flight parse:** If a parse process is already running for this
  project, send SIGINT before starting a new one
- Spawns `dbt parse` via `child_process.spawn` (not in a visible terminal — this
  is a background operation)
- The manifest watcher (from `DbtProject.ensureLoaded`) picks up the change

- [ ] **Step 3: Register in `src/extension.ts`**

- Register `TextDocumentContentProvider` for the `dbt-compiled` scheme
- Register `dbtCoreTools.showCompiledSql` command
- Call `registerParseOnSave(context)`
- Wire manifest change events: when a project's manifest changes, fire
  `compiledSqlProvider.fireChange()` for any open compiled documents from that
  project

- [ ] **Step 4: Build and commit**

```bash
npm run build
git add src/features/compiledSql.ts src/features/parseOnSave.ts src/extension.ts
git commit -m "feat: add compiled SQL viewer with parse-on-save"
```

---

## Task 12: Feature 6 — Definition, Hover, and Completion Providers

These are tightly coupled (all use manifest + pattern matching) so they are
implemented together.

**Files:**

- Create: `src/features/definition.ts`, `src/features/hover.ts`,
  `src/features/completion.ts`
- Modify: `src/extension.ts`

- [ ] **Step 1: Implement `src/features/definition.ts`**

`DbtDefinitionProvider` implements `DefinitionProvider`:

- `provideDefinition(document, position)`:
  1. Find project for file
  2. Get current line text and cursor character
  3. Check `findRefAtPosition` — if match, look up node by name, return
     `Location` pointing to `original_file_path` in the project
  4. Check `findSourceAtPosition` — if match, find source in manifest by
     `source_name` + `name`, return `Location` to `original_file_path`
  5. Check word at position against project macros — if match, return `Location`
     to macro's `original_file_path`

- [ ] **Step 2: Implement `src/features/hover.ts`**

`DbtHoverProvider` implements `HoverProvider`:

- `provideHover(document, position)`:
  1. Check for `ref()` at position — if found, look up node columns
  2. Check for `source()` at position — if found, look up source columns
  3. Format columns as a Markdown table: `| Column | Type | Description |`
  4. Return `Hover` with the formatted markdown

- [ ] **Step 3: Implement `src/features/completion.ts`**

`DbtCompletionProvider` implements `CompletionItemProvider`:

- `provideCompletionItems(document, position)`:
  1. Get text before cursor on the current line
  2. If matches `ref(\s*['"]?$` — return model names from manifest nodes (kind:
     `Reference`, detail: resource type)
  3. If matches `source(\s*['"]?$` — return unique source names (kind: `Module`)
  4. If matches `source(\s*['"](\w+)['"]\s*,\s*['"]?$` — return table names for
     that source (kind: `Field`)
  5. If matches `{{\s*$` — return macro names (kind: `Function`, detail: package
     name)
  6. If matches `config(\s*$` — return static list of config keys (kind:
     `Property`): `materialized`, `schema`, `alias`, `tags`, `enabled`,
     `pre_hook`, `post_hook`, `persist_docs`, `full_refresh`, `unique_key`,
     `strategy`, `updated_at`, `on_schema_change`, `grant_access_to`,
     `hours_to_expiration`, `partition_by`, `cluster_by`,
     `require_partition_filter`

Register trigger characters: `(`, `{`

- [ ] **Step 4: Register providers in `src/extension.ts`**

Register all three providers for document selector
`[{language: "sql", scheme: "file"}, {language: "jinja-sql", scheme: "file"}]`.

- [ ] **Step 5: Build and commit**

```bash
npm run build
git add src/features/definition.ts src/features/hover.ts src/features/completion.ts src/extension.ts
git commit -m "feat: add go-to-definition, hover, and autocomplete providers"
```

---

## Task 13: Feature 5 — Model Preview Panel

Webview panel displaying `dbt show` results in a sortable HTML table.

**Files:**

- Create: `src/features/preview/previewPanel.ts`,
  `src/features/preview/webview/index.html`,
  `src/features/preview/webview/main.js`,
  `src/features/preview/webview/styles.css`
- Modify: `src/commands/modelCommands.ts` (replace `showModel` stub)

- [ ] **Step 1: Implement webview HTML, JS, and CSS**

`index.html` — minimal shell with `#header` and `#content` divs, script and
style references.

`main.js`:

- Listens for `message` events from the extension host
- `results` message: renders an HTML table with sortable column headers (click
  to sort ascending). Shows model name + row count in header.
- `error` message: renders monospace error text with model name, command, and a
  "Copy Error" button. Button sends `{type: "copy", text}` back to host.

`styles.css`:

- Uses VS Code CSS variables for theming (`--vscode-foreground`,
  `--vscode-editor-background`, `--vscode-panel-border`, etc.)
- Table: collapsed borders, hover highlight on rows, pointer cursor on headers
- Error: `white-space: pre-wrap`, scrollable, monospace font
- Copy button: VS Code button colors

- [ ] **Step 2: Implement `src/features/preview/previewPanel.ts`**

`showModelPreview(context)`:

- Gets active project and model name
- Builds `dbt show` command via `buildDbtCommand` with `showLimit` from settings
- Calls `executeAndCapture` to run the command
- Creates or reveals a `WebviewPanel` (`viewColumn: Two`, scripts enabled)
- Parses `dbt show` output: markdown-style table with `|` delimiters. Split on
  `|`, trim, skip separator line (index 1).
- Posts `{type: "results", columns, rows, modelName}` or
  `{type: "error", error, modelName, command}` to webview
- Handles `copy` message from webview: writes to clipboard

- [ ] **Step 3: Update `showModel` in `src/commands/modelCommands.ts`**

Replace the stub with a call to `showModelPreview(context)`. This requires
access to `ExtensionContext` — store it in a module-level variable during
`activate()`.

- [ ] **Step 4: Build and commit**

```bash
npm run build
git add src/features/preview/ src/commands/modelCommands.ts src/extension.ts
git commit -m "feat: add model preview panel with sortable table and error display"
```

---

## Task 14: Feature 4 — Toggle SQL/Properties and Column Sync

**Files:**

- Create: `src/features/properties.ts`, `src/features/columnSync.ts`
- Test: `test/unit/properties.test.ts`
- Modify: `src/extension.ts`

- [ ] **Step 1: Write failing tests for YAML scaffolding**

Test `scaffoldYaml(modelName, columns)`:

- With columns: output includes `version: 2`, `models:`, model name entry, and
  all column names under `columns:`. No `description:` keys.
- Without columns: output includes model name but no `columns:` section.

- [ ] **Step 2: Run tests to verify they fail**

Expected: FAIL.

- [ ] **Step 3: Implement `src/features/properties.ts`**

`scaffoldYaml(modelName, columns)` — returns a YAML string:

```yaml
version: 2

models:
  - name: { modelName }
    columns:
      - name: { col1 }
      - name: { col2 }
```

`toggleProperties()`:

- If current file is `.sql`: look up model in manifest
  - If `patch_path` exists: open that `.yml` file, scroll to the model entry
    (regex search for `- name: {modelName}`)
  - If no `patch_path`: scaffold a new YAML file in the same directory, named
    `{modelName}.yml`, with columns from the manifest node
- If current file is `.yml`: find nearest `- name:` above cursor, look up model
  in manifest, open its `.sql` file via `original_file_path`

`patch_path` format in the manifest is `{package}://{relative_path}` — strip the
prefix before joining with project root.

- [ ] **Step 4: Implement `src/features/columnSync.ts`**

`syncColumns()`:

1. Resolve model name (from `.sql` filename or `.yml` cursor position)
2. Find node in manifest. If not found, warn and return.
3. **Contract check:** If `node.contract.enforced`, show a modal warning with
   the column diff and require "Continue" confirmation.
4. Find the YAML file via `patch_path`. If none, warn to use Toggle first.
5. Parse existing columns from the YAML (line-based: find model entry, find
   `columns:` section, collect `- name:` entries).
6. Diff: new columns (in manifest, not in YAML), removed columns (in YAML, not
   in manifest).
7. **Description propagation:** For new columns, check upstream models
   (`depends_on.nodes`) for matching column names with descriptions. Pre-fill if
   found.
8. Insert new column entries into the YAML at the end of the columns section.
9. Add `# REMOVED: not in manifest` comments to removed column entries.
10. Write the file and open it.

- [ ] **Step 5: Register commands in `src/extension.ts`**

Register `dbtCoreTools.toggleProperties` and `dbtCoreTools.syncColumns`.

- [ ] **Step 6: Run tests and build**

Expected: Tests PASS, build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/features/properties.ts src/features/columnSync.ts test/unit/properties.test.ts src/extension.ts
git commit -m "feat: add toggle SQL/properties and column sync"
```

---

## Task 15: Feature 3 — Lineage Viewer

The largest feature — webview with D3.js/dagre graph rendering, expand/collapse,
context menu, and node styling.

**Files:**

- Create: `src/features/lineage/lineagePanel.ts`,
  `src/features/lineage/webview/index.html`,
  `src/features/lineage/webview/main.js`,
  `src/features/lineage/webview/styles.css`
- Modify: `src/extension.ts`

D3 and dagre are loaded via CDN in the webview (no bundling needed for webview
scripts). The webview is sandboxed and cannot import from the extension.

- [ ] **Step 1: Implement webview HTML**

Shell with: CSP meta tag allowing `cdn.jsdelivr.net` scripts, CSS link, SVG
element for the graph, context menu div (hidden), lock toggle checkbox, D3 and
dagre loaded from CDN, inline script placeholder.

- [ ] **Step 2: Implement webview JS (`main.js`)**

Core logic:

- Receives `setGraph` and `updateCenter` messages from extension host
- `setGraph`: stores graph data (nodes + edges), visible node IDs, current model
  ID. Calls `render()`.
- `updateCenter`: if not locked, updates current model and re-renders.
- `render()`: uses dagre to layout the DAG (left-to-right), D3 to draw SVG.

Node rendering:

- Rectangle colored by resource type (model, source, test, exposure, seed) using
  VS Code CSS variables
- Current model: thicker border (`--vscode-focusBorder`)
- Contract badge: shield emoji on nodes with `contractEnforced: true`
- Dashed border for contracted models
- Name label (centered) + materialization label (bottom, smaller)

Interactions:

- Click node: posts `{type: "openFile", nodeId}` to host
- Right-click: shows custom context menu with Open File, Toggle SQL/Properties,
  Run/Build/Test/Show Model
- Expand handles: `triangleRight` (downstream) and `triangleLeft` (upstream) at
  node edges. Click posts `{type: "expand", nodeId, direction}`.
- Lock toggle: checkbox that prevents `updateCenter` from re-centering

- [ ] **Step 3: Implement webview CSS**

Use VS Code CSS variables throughout. Style node rectangles, labels, edges,
expand handles, and context menu. Context menu: fixed position, VS Code menu
colors, hover highlight.

- [ ] **Step 4: Implement `src/features/lineage/lineagePanel.ts`**

`showLineage(context)`:

- Gets active project and model, finds node in manifest
- Creates or reveals webview panel (`retainContextWhenHidden: true`)
- Calls `buildGraphData(project, nodeId, depth=1)` and posts to webview

`buildGraphData(project, centerId, depth)`:

- Uses `child_map` and `parent_map` from manifest to walk the graph
- Recursive `expandUpstream` and `expandDownstream` with depth limit
- Returns `{nodes: GraphNode[], edges: GraphEdge[]}` where `GraphNode` includes
  `id`, `name`, `resourceType`, `materialization`, `contractEnforced`

Message handler:

- `openFile`: opens the node's SQL file
- `expand`: rebuilds graph centered on the expanded node
- `runModel`/`buildModel`/`testModel`/`showModel`/`toggleProperties`: delegates
  to the corresponding registered command

`updateLineageCenter(context)`:

- Called on `onDidChangeActiveTextEditor`
- If panel exists and not locked, posts `updateCenter` with new graph data

- [ ] **Step 5: Register in `src/extension.ts`**

Register `dbtCoreTools.showLineage` command. Add `onDidChangeActiveTextEditor`
listener for `updateLineageCenter`.

- [ ] **Step 6: Build and commit**

```bash
npm run build
git add src/features/lineage/ src/extension.ts
git commit -m "feat: add lineage viewer with D3/dagre graph"
```

---

## Task 16: Integration — Final Wiring and Build Verification

Connect all remaining loose ends, verify the full build, and test the extension
launch.

**Files:**

- Modify: `src/extension.ts` (final integration)

- [ ] **Step 1: Audit `src/extension.ts`**

Ensure every command in `package.json` has a corresponding `registerCommand`
call. Verify all event listeners are registered and disposables are pushed.

- [ ] **Step 2: Full build**

```bash
npm run build
```

Expected: `dist/extension.js` created, no errors.

- [ ] **Step 3: Package as VSIX**

```bash
npx @vscode/vsce package --allow-missing-repository
```

Expected: `dbt-core-tools-0.0.1.vsix` created.

- [ ] **Step 4: Install and test in VS Code**

Open the teamster workspace, install the VSIX:

```text
Ctrl+Shift+P > Extensions: Install from VSIX > select the .vsix file
```

Verify:

- Extension activates (check Output > dbt Core Tools)
- Status bar items appear when opening a `.sql` file in `src/dbt/kipptaf/`
- Run Model button appears in editor title bar
- Command palette shows all `dbt Core Tools:` commands

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: final integration wiring"
```

---

## Task 17: Documentation

**Files:**

- Create: `README.md`

- [ ] **Step 1: Write README**

Minimal README with: what the extension does, settings reference, feature list,
and installation instructions. Use the spec as source material.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README"
```

---

## Post-Implementation Notes

**Deferred features** (noted in spec evaluations, not in this plan):

- Snippets/templates for new SQL models
- WHERE-clause filtering on `dbt show`
- VS Code walkthrough contribution point for onboarding
- Test authoring shortcuts in YAML
- Re-run Last Command
- Test coverage indicator on lineage nodes

**YAML schema note:** The `yamlValidation` URLs in `package.json` reference
`dbt-jsonschema` tags. Before publishing, verify the correct tag exists at
`github.com/dbt-labs/dbt-jsonschema/tags` and update if needed.

**Publishing:** Requires a VS Code Marketplace publisher account under
`TEAMSchools` and a Personal Access Token from `dev.azure.com`.
