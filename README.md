# dbt Core Tools

A VS Code extension that wraps dbt Core CLI. No language server — just direct CLI integration with six focused features.

**Publisher:** TEAMSchools  
**Activation:** Opens automatically when a workspace contains a `dbt_project.yml` file.

**Requires:** [YAML (Red Hat)](https://marketplace.visualstudio.com/items?itemName=redhat.vscode-yaml)

---

## Installation

Install from the VS Code Marketplace by searching for **dbt Core Tools** (publisher: TEAMSchools), or install the `.vsix` directly:

```text
Extensions: Install from VSIX...
```

dbt Core must be installed and accessible from your shell. By default the extension calls `dbt`; adjust `dbtCoreTools.dbtCommand` if you use a wrapper like `uv run dbt`.

---

## Features

### Command Runner

Run, build, test, and show models from the editor title bar or the command palette. Each action also has an "Options" variant that lets you pick upstream (`+model`), downstream (`model+`), and full-refresh before executing.

Lifecycle commands available from the command palette:

| Command                | Description                                      |
| ---------------------- | ------------------------------------------------ |
| Setup Project          | `dbt deps` + `dbt parse` for the current project |
| Setup All Projects     | Same for every discovered project                |
| Install Dependencies   | `dbt deps`                                       |
| Parse Project          | `dbt parse`                                      |
| Clean Project          | `dbt clean`                                      |
| Debug                  | `dbt debug`                                      |
| Retry                  | Re-run the last failed command                   |
| Stage External Sources | Run `dbt-external-tables` stage macro            |

### Compiled SQL Viewer

Opens compiled SQL from the manifest in a side-by-side diff view. Stays current when parse-on-save is enabled.

Command: `dbt Core Tools: Show Compiled SQL`

### Lineage Viewer

DAG visualization using React Flow. Nodes expand and collapse; right-click for context actions. A lock toggle keeps the view pinned to a specific model.

Command: `dbt Core Tools: Show Lineage`

### Jump to Properties / Model

Toggle between a `.sql` model file and its corresponding `.yml` properties file. If no properties file exists it can scaffold one. Also provides a Sync Columns command to write column names from the manifest into the YAML.

Commands: `dbt Core Tools: Toggle SQL/Properties`, `dbt Core Tools: Sync Columns`

### Model Preview

Run `dbt show` and display results in a sortable HTML table inside VS Code.

Command: `dbt Core Tools: Show Model`  
Row limit controlled by `dbtCoreTools.showLimit`.

### Code Intelligence

Powered by the parsed manifest:

- **Go to definition** — jump to the model or source referenced by `ref()` or `source()`
- **Hover** — show column descriptions from the manifest
- **Autocomplete** — suggestions for `ref()`, `source()`, `macro()`, and `config()` arguments

---

## Settings

All settings are under the `dbtCoreTools` namespace.

| Setting                                 | Type    | Default | Description                                                                          |
| --------------------------------------- | ------- | ------- | ------------------------------------------------------------------------------------ |
| `dbtCoreTools.dbtCommand`               | string  | `"dbt"` | Command used to invoke dbt. Use `"uv run dbt"` or similar if needed.                 |
| `dbtCoreTools.projectDirectories`       | array   | `[]`    | Explicit project paths. When empty, projects are auto-discovered from the workspace. |
| `dbtCoreTools.profilesDir`              | string  | `""`    | Path to the directory containing `profiles.yml`.                                     |
| `dbtCoreTools.compileOnSave`            | boolean | `true`  | Run `dbt compile` automatically when a `.sql` file is saved.                         |
| `dbtCoreTools.deferManifestPath`        | object  | `{}`    | Per-project path to a manifest used for `--defer`. Keys are project names.           |
| `dbtCoreTools.stageExternalSourcesVars` | object  | `{}`    | Vars passed to `stage_external_sources`. Supports `${projectName}` interpolation.    |
| `dbtCoreTools.showLimit`                | integer | `5`     | Row limit passed to `dbt show`.                                                      |

### Example workspace settings

```json
{
  "dbtCoreTools.dbtCommand": "uv run dbt",
  "dbtCoreTools.profilesDir": "/home/user/.dbt",
  "dbtCoreTools.compileOnSave": true,
  "dbtCoreTools.deferManifestPath": {
    "my_project": "/ci/target/manifest.json"
  },
  "dbtCoreTools.showLimit": 10
}
```

---

## Multi-project workspaces

Projects are discovered automatically by locating `dbt_project.yml` files (excluding `dbt_packages/` and `dbt_modules/`). To pin specific directories instead of relying on auto-discovery, set `dbtCoreTools.projectDirectories`.

Per-project settings (`deferManifestPath`, `stageExternalSourcesVars`) use the project name as the key, matching the `name` field in `dbt_project.yml`. Target selection is available via the status bar and resets to the profile default on window reload.

---

## YAML validation

The extension registers JSON schema validation for `dbt_project.yml`, `selectors.yml`, and `packages.yml` via the Red Hat YAML extension (schemas sourced from `dbt-labs/dbt-jsonschema`).

---

## Build & Publish

### Prerequisites

- Node.js 22+
- A [Personal Access Token](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#get-a-personal-access-token) for the `TEAMSchools` publisher on the VS Code Marketplace

### Build

```bash
npm install
npm run build
```

### Package as VSIX

```bash
npx @vscode/vsce package --allow-missing-repository
```

This produces a `.vsix` file that can be installed manually via `Extensions: Install from VSIX...` in VS Code.

### Publish to Marketplace

```bash
npx @vscode/vsce publish --allow-missing-repository
```

You will be prompted for the PAT. To avoid the prompt, set the `VSCE_PAT` environment variable or log in first:

```bash
npx @vscode/vsce login TEAMSchools
npx @vscode/vsce publish --allow-missing-repository
```

### Version bumps

Update `version` in `package.json` before publishing. The marketplace rejects duplicate version numbers.

---

## License

MIT
