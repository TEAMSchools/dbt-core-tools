# dbt Core Tools — VS Code Extension Design

**Date:** 2026-04-02 **Status:** Draft

## Problem

dbt Power User (`innoverio.vscode-dbt-power-user`) is the only VS Code extension
that works with dbt Core, but it has significant pain points:

- Crashes with `deferToProduction: true` on dbt 1.11.7
- Aggressive project discovery causes slowdowns across 15 dbt projects
- Requires the Datamates companion extension (unused)
- The official dbt Labs extension (`dbtLabsInc.dbt`) requires dbt Fusion (not
  GA, proprietary LSP, no Codespaces SSH support)

## Solution

Build a thin VS Code extension wrapping dbt Core CLI. No LSP, no framework, no
auto-detection magic. Six features:

1. dbt command runner
2. Compiled SQL viewer
3. Lineage viewer
4. Jump to properties / jump to model (bidirectional)
5. Model preview
6. Manifest-based navigation & autocomplete

## Audience

Primary: KIPP TEAM & Family Schools data team. Designed generically enough for
any dbt Core user — published to the VS Code marketplace.

## Tech Stack

- TypeScript, VS Code Engine `^1.85.0`
- Bundled with esbuild
- D3.js + dagre for lineage graph rendering (webview)
- Plain HTML/JS for webview panels (no React/Svelte)
- Standalone repository with its own build/publish lifecycle

---

## Extension Settings

| Setting                                 | Type     | Default | Description                                                                                          |
| --------------------------------------- | -------- | ------- | ---------------------------------------------------------------------------------------------------- |
| `dbtCoreTools.dbtCommand`               | string   | `"dbt"` | Command prefix for invoking dbt (e.g., `"uv run dbt"`)                                               |
| `dbtCoreTools.projectDirectories`       | string[] | `[]`    | Explicit project paths; if empty, auto-discovered                                                    |
| `dbtCoreTools.profilesDir`              | string   | `""`    | Path to profiles directory; when empty, dbt uses default resolution                                  |
| `dbtCoreTools.target`                   | object   | `{}`    | Per-project target (key: project name, value: target name); when empty, dbt uses the profile default |
| `dbtCoreTools.parseOnSave`              | boolean  | `true`  | Run `dbt parse` on explicit save of `.sql` files                                                     |
| `dbtCoreTools.deferManifestPath`        | object   | `{}`    | Per-project defer manifest path (key: project name, value: relative path)                            |
| `dbtCoreTools.stageExternalSourcesVars` | object   | `{}`    | Vars passed to `stage_external_sources`; supports `${projectName}` interpolation                     |
| `dbtCoreTools.showLimit`                | integer  | `5`     | Row limit for `dbt show` output                                                                      |

---

## Project Discovery & Lifecycle

### Discovery

At activation, the extension finds dbt projects in the workspace:

1. `workspace.findFiles('**/dbt_project.yml')` — respects `.gitignore` and
   `files.exclude` (handles worktrees correctly since `.worktrees/` is
   gitignored)
2. Filter out paths containing `/dbt_packages/` or `/dbt_modules/`
3. If `dbtCoreTools.projectDirectories` is non-empty, use those paths instead

Each discovered project is tracked with its root path and manifest location
(`target/manifest.json`). Manifests are loaded lazily — a project's manifest is
read and its file watcher created only when the user first opens a file in that
project. This avoids reading all 15 manifests at startup.

### Active project resolution

When editing a file, the extension determines which project it belongs to by
matching the file path against discovered project root paths.

### YAML schema integration

The extension contributes YAML schemas via the `yaml.schemas` contribution
point, auto-applied to files within discovered project directories. Requires the
Red Hat YAML extension (`redhat.vscode-yaml`) as a dependency.

- `dbt_project.yml` → dbt project schema
- `selectors.yml` → dbt selectors schema
- `packages.yml` → dbt packages schema
- All other `.yml` files in project dirs → dbt yml files schema

Schemas are referenced from `dbt-labs/dbt-jsonschema` (pinned to a specific
version, not `latest`). This eliminates manual `yaml.schemas` configuration from
workspace settings.

### Lifecycle commands

| Command                                | Action                                                     |
| -------------------------------------- | ---------------------------------------------------------- |
| `dbt Core Tools: Setup Project`        | `dbt deps` then `dbt parse` for active project             |
| `dbt Core Tools: Setup All Projects`   | `dbt deps` then `dbt parse` for each discovered project    |
| `dbt Core Tools: Install Dependencies` | `dbt deps` for active project                              |
| `dbt Core Tools: Parse Project`        | `dbt parse` for active project                             |
| `dbt Core Tools: Clean Project`        | `dbt clean` for active project                             |
| `dbt Core Tools: Debug`                | `dbt debug` for active project                             |
| `dbt Core Tools: Retry`                | `dbt retry` for active project (re-runs failed nodes only) |

---

## Feature 1: dbt Command Runner

### Commands

All commands resolve the current model from the active `.sql` editor filename
and scope to the active project via `--project-dir`.

| Command                  | dbt invocation                                         |
| ------------------------ | ------------------------------------------------------ |
| `Run Model`              | `dbt run -s <model>`                                   |
| `Build Model`            | `dbt build -s <model>`                                 |
| `Test Model`             | `dbt test -s <model>`                                  |
| `Show Model`             | `dbt show -s <model> --limit <showLimit>`              |
| `Stage External Sources` | `dbt run-operation stage_external_sources` (see below) |

Run, Build, and Test each have a single command. The editor button click runs
the plain command immediately. The editor button dropdown opens the options
picker (see below).

### Stage External Sources

Runs `dbt run-operation stage_external_sources` with vars from
`dbtCoreTools.stageExternalSourcesVars` (interpolating `${projectName}` from the
project's `dbt_project.yml` `name` field).

- **From a `.sql` model file:** Parses the file for `source()` calls, extracts
  source names, and passes `--args 'select: <source_name>'` to scope staging to
  just the sources referenced in the open model.
- **From the command palette without a model context:** Stages all external
  sources for the active project (no `--args` filter).

### Options picker (editor button dropdown)

Accessed via the dropdown chevron on Run, Build, and Test editor buttons.
Presented as a VS Code quick pick with `canPickMany` enabled:

- ☐ Full Refresh
- ☐ Upstream
- ☐ Downstream

The user checks any combination and confirms. Selecting none and confirming runs
the plain single-model command (same as clicking the button directly). The
extension builds the command from the selection:

| Selection               | Result                         |
| ----------------------- | ------------------------------ |
| (none)                  | `<model>`                      |
| Upstream                | `+<model>`                     |
| Downstream              | `<model>+`                     |
| Upstream + Downstream   | `+<model>+`                    |
| Full Refresh            | `<model> --full-refresh`       |
| Full Refresh + Upstream | `+<model> --full-refresh`      |
| (any combo)             | selector + flag as appropriate |

### Execution

- Commands run in a VS Code terminal instance (visible output, cancellable)
- The `dbtCommand` setting is prepended, plus `--project-dir=<project-root>`
- When `dbtCoreTools.profilesDir` is set, `--profiles-dir <path>` is appended
- When `dbtCoreTools.target` is set, `--target <value>` is appended
- When defer is toggled on and a manifest path is configured,
  `--defer --state <path>` is appended to run, build, and test commands
- Only one dbt command runs per project at a time — reject with a notification
  if busy
- `Show Model` captures stdout programmatically instead of using a terminal
  (feeds into the results panel)
- **Cancellation:** A progress notification with a cancel button appears while a
  command is running. Clicking cancel sends SIGINT to the dbt process. The user
  can also Ctrl+C in the terminal for terminal-based commands.

### Status bar

Three status bar items, visible when a dbt project file is active. Each item is
prefixed with the active project name (e.g., `kipptaf | dbt: defer`) so the user
always knows which project context they are in.

- **Target selector** — displays the current target (e.g.,
  `kipptaf | dbt: defer`). Click to open a quick pick of available targets
  parsed from the active project's profile in `profiles.yml`. Selecting a target
  updates `dbtCoreTools.target` for the active project. When no target is
  configured, shows the profile's default.
- **Defer toggle** — displays `defer: on` or `defer: off`. Click to toggle. When
  `dbtCoreTools.deferManifestPath` is configured for the active project, the
  toggle is enabled. When no manifest path is configured, shows `defer: n/a`
  (click opens settings). Tooltip explains defer in plain language: "When on,
  only builds models you've changed — unchanged models read from production."
- **Manifest timestamp** — displays the manifest's last-modified time (e.g.,
  `parsed: 2:34 PM`). Click triggers `dbt parse`. When a dbt command is running,
  temporarily shows `dbt: building...` (or `parsing...`, `testing...`) with a
  spinner so the user always knows at a glance that a command is in-flight.

### Context menu

Right-click a `.sql` file in the editor or explorer to access Run, Build, Test,
and Show commands.

### Editor title bar buttons

Buttons appear when a `.sql` file in a discovered dbt project is active
(`editor/title` contribution point with `when` clause):

| Button        | Click action           | Dropdown       | Visibility                                 |
| ------------- | ---------------------- | -------------- | ------------------------------------------ |
| Run           | Run Model              | Options picker | Any `.sql` model file                      |
| Build         | Build Model            | Options picker | Any `.sql` model file                      |
| Test          | Test Model             | Options picker | Any `.sql` model file                      |
| Show          | Show Model             | —              | Any `.sql` model file                      |
| Stage Sources | Stage External Sources | —              | `.sql` files with `source()` refs          |
| Lineage       | Show Lineage           | —              | Any `.sql` model file                      |
| Compiled      | Show Compiled SQL      | —              | Any `.sql` model file                      |
| Properties    | Toggle SQL/Properties  | —              | Any `.sql` or `.yml` file in a dbt project |

Run, Build, and Test use VS Code submenu dropdowns (chevron expander). The
dropdown opens the options picker (`canPickMany` quick pick with Full Refresh,
Upstream, Downstream). Stage Sources is conditionally visible — only shown when
the active file contains `source()` calls. All other buttons trigger their
command directly.

All buttons must have descriptive tooltips that explain their action in plain
language (e.g., "Run this model in the warehouse", "Show compiled SQL with Jinja
resolved", "Stage external sources referenced in this model"). Tooltips should
be understandable to someone unfamiliar with dbt terminology.

---

## Feature 2: Compiled SQL Viewer

### Trigger

- Automatic: `dbt parse` runs on explicit save of `.sql` model files (when
  `parseOnSave` is enabled), scoped to the active project
- Manual: command `dbt Core Tools: Show Compiled SQL`

### Manifest watching

Each discovered project has a `FileSystemWatcher` on `target/manifest.json`.
When the manifest changes (from parse, external terminal, or any other source),
the extension reads `compiled_code` for all open model documents.

### Display

A read-only virtual document in a side-by-side editor split, using a
`TextDocumentContentProvider` registered to a custom URI scheme
(`dbt-compiled:`). The editor refreshes automatically when the content provider
fires a change event.

### Flow

1. User saves a `.sql` file (explicit save, not auto-save)
2. If a parse is already in-flight for this project, cancel it (SIGINT) before
   starting a new one — prevents queuing stale parses from rapid saves
3. Extension runs `dbt parse --project-dir=<project-root>`
4. Manifest watcher detects the update
5. Extension reads `compiled_code` from the manifest node matching the model
6. Virtual document updates — rendered SQL appears alongside the source

### Missing manifest entry

If the model has no entry in the manifest (fresh project or new model), the
extension triggers `dbt parse` automatically. The compiled view populates once
the manifest updates.

---

## Feature 3: Lineage Viewer

### Display

A webview panel showing a directed acyclic graph (DAG) centered on the current
model.

### Trigger

- Command: `dbt Core Tools: Show Lineage`
- Editor title bar button
- Context menu on `.sql` files

### Data source

Reads `target/manifest.json` — nodes, sources, and `depends_on` relationships.
Same manifest watcher keeps lineage current.

### Graph behavior

- **Initial view:** Current model + 1 level of parents + 1 level of children
- **Expand/collapse:** Click a node's expand handle to load the next level in
  that direction. Collapse hides descendants/ancestors.
- **Node styling:** Nodes styled by resource type (model, source, test,
  exposure, seed). Materialization type (view, table, incremental, ephemeral)
  shown as a subtle label or icon variant. Models with
  `contract: {enforced: true}` display a contract badge (e.g., shield icon) to
  indicate breaking changes will affect downstream consumers.
- **Current model:** Visually highlighted so you don't lose context
- **Click a node:** Opens the model's `.sql` file in the VS Code editor
- **Lock toggle:** Pin the lineage to a specific model. When unlocked (default),
  the view re-centers when the active editor changes to a different model file.

### Right-click context menu on nodes

A custom context menu rendered in the webview:

- Open File
- Toggle SQL/Properties
- Run Model
- Build Model
- Test Model
- Show Model

The webview sends a message to the extension host with the node ID and action.
The extension executes the corresponding command with the specified model name.

### Rendering

D3.js with dagre for automatic DAG layout (left-to-right). SVG rendered in a
webview panel. No framework.

### Scope

Single-project lineage from one manifest. Cross-project lineage (resolving
`source()` references to models in other projects) is a future enhancement that
would require loading multiple manifests.

---

## Feature 4: Jump to Properties / Jump to Model

A single bidirectional command that navigates between a model's SQL and its
properties YAML.

### Trigger

- Command: `dbt Core Tools: Toggle SQL/Properties`
- Editor title bar button (visible on both `.sql` and `.yml` files in dbt
  projects)
- Context menu on `.sql` and `.yml` files
- Lineage viewer right-click menu

### Resolution

**From `.sql` → YAML:**

1. Get the model name from the file
2. Look up the node in the manifest — the `patch_path` field identifies which
   `.yml` file defines the model's properties
3. If `patch_path` exists: open the `.yml` file and scroll to the model's YAML
   entry
4. If `patch_path` is absent: scaffold new properties

**From `.yml` → SQL:**

1. Determine which model entry the cursor is inside (by parsing the YAML
   structure for the nearest `- name:` key)
2. Look up the model in the manifest — the `path` field identifies the `.sql`
   file
3. Open the `.sql` file

### Scaffolding

When a model has no properties entry:

- **Target file:** Same directory as the `.sql` file, named to match the model
  (e.g., `stg_powerschool__students.sql` → `stg_powerschool__students.yml`). One
  properties file per model. Create it with the `models:` key.
- **Content:** Model name and column names only. No empty attributes
  (`description`, `tests`, etc. omitted).

```yaml
version: 2

models:
  - name: stg_powerschool__students
    columns:
      - name: studentid
      - name: first_name
      - name: last_name
```

Column names are pulled from the manifest node's compiled columns (if
available).

- **After scaffolding:** Open the file and position the cursor at the new entry.

### Column sync

Command: `dbt Core Tools: Sync Columns`

Diffs the manifest's compiled columns against the model's properties YAML:

- **New columns** (in manifest but not in YAML): appended to the YAML entry.
- **Removed columns** (in YAML but not in manifest): flagged with a comment but
  not auto-deleted (may be intentional exclusions).
- **Description propagation:** When a column has a description in an upstream
  model's properties (traced via manifest `depends_on` and column name
  matching), the sync pre-fills the description for new column entries. Existing
  descriptions are never overwritten.
- Preserves all existing attributes (tests, descriptions, meta) on columns that
  are already defined.

**Contracted models:** When syncing a model with `contract: {enforced: true}`,
the command shows a confirmation warning before applying changes. Adding or
removing columns from a contracted model changes its public interface and can
break downstream consumers. The diff is shown in the confirmation so the user
can review exactly what will change before accepting.

---

## Feature 5: Model Preview

### Trigger

- Command: `dbt Core Tools: Show Model`
- Editor title bar button
- Context menu on `.sql` files
- Lineage viewer right-click menu

### Execution

Runs
`<dbtCommand> show -s <model> --project-dir=<project-root> --limit <showLimit>`
with defer flags if configured. Captures stdout programmatically (not in a
visible terminal).

### Display

A webview panel in the bottom editor area with an HTML table:

- Sortable columns (click header to sort)
- Row count displayed in the header
- Panel persists — running Show on a different model replaces the content
- **Error display:** If the command fails, the panel shows the error in
  monospace text (preserving dbt output formatting), scrollable, with a header
  showing the model name and command that failed, and a "Copy Error" button

---

## Feature 6: Manifest-Based Navigation & Autocomplete

Lightweight code navigation and completions using VS Code's `DefinitionProvider`
and `CompletionItemProvider` APIs — no LSP required. Populated from the manifest
after `dbt parse`.

### Go to Definition

Registered as a `DefinitionProvider` for `.sql` files. Enables F12 / right-click
"Go to Definition" / Ctrl+click for dbt references:

| Pattern                               | Resolves to                                      |
| ------------------------------------- | ------------------------------------------------ |
| `ref('model_name')`                   | Model's `.sql` file from manifest node `path`    |
| `source('source_name', 'table_name')` | Source definition in `.yml` from manifest `path` |
| `macro_name()`                        | Macro file from manifest macro `path`            |

Resolution: pattern-match the cursor position against `ref(`, `source(`, or
known macro names, look up the manifest, return the file URI and position.

### Hover

Registered as a `HoverProvider` for `.sql` files. Hovering over a `ref()` or
`source()` call displays the referenced model's column list (names and
descriptions, if available) from the manifest. Gives quick visibility into
upstream schema without navigating away.

### Autocomplete

| Trigger      | Completion                                                           |
| ------------ | -------------------------------------------------------------------- |
| `ref(`       | Model names from manifest nodes                                      |
| `source(`    | Source names; after selecting a source, table names for it           |
| `{{`         | Macro names from manifest (project macros + installed packages)      |
| `{{ config(` | Static list of common config keys (materialized, tags, schema, etc.) |

### Behavior

- Both providers are scoped to the active project's manifest
- Completion items include detail text (e.g., model description, macro package)
- Lists refresh when the manifest watcher detects changes
- Trigger characters: `(` (for ref/source), `{` (for macros)

### Limitations

- No context awareness — triggers on pattern match regardless of whether the
  cursor is inside a Jinja block or raw SQL
- No SQL keyword or column completions
- No inline error detection or diagnostics

---

## Not in Scope

- Full LSP (context-aware completions, diagnostics, rename refactoring)
- Cross-project lineage (future enhancement)
- Form-based YAML editing
- Auto-running `dbt deps`
- Python environment detection / auto-configuration
- dbt Cloud integration
- Datamates or any companion extension requirement
