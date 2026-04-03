import * as vscode from "vscode";
import { ProjectDiscovery } from "./core/discovery";
import { DbtProject } from "./core/project";
import {
  setupProject,
  setupAllProjects,
  installDeps,
  parseProject,
  cleanProject,
  debugProject,
  retryProject,
} from "./commands/lifecycle";

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let _discovery: ProjectDiscovery | null = null;
let _activeProject: DbtProject | null = null;

// ---------------------------------------------------------------------------
// Public getters (for use by commands, features, etc.)
// ---------------------------------------------------------------------------

export function getDiscovery(): ProjectDiscovery {
  if (!_discovery) {
    throw new Error("dbt Core Tools: extension not yet activated");
  }
  return _discovery;
}

export function getActiveProject(): DbtProject | null {
  return _activeProject;
}

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  _discovery = new ProjectDiscovery();

  // Discover projects in the workspace.
  await _discovery.discover();

  // Set initial context keys and lazy-load for whatever is open on startup.
  await updateContextKeys(vscode.window.activeTextEditor);

  // React to editor focus changes.
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(async (editor) => {
      await updateContextKeys(editor);
    })
  );

  // Register YAML schema for dbt yml files via the Red Hat YAML extension.
  await registerYamlSchema();

  // Register lifecycle commands.
  context.subscriptions.push(
    vscode.commands.registerCommand("dbtCoreTools.setupProject", () => setupProject()),
    vscode.commands.registerCommand("dbtCoreTools.setupAllProjects", () => setupAllProjects()),
    vscode.commands.registerCommand("dbtCoreTools.installDeps", () => installDeps()),
    vscode.commands.registerCommand("dbtCoreTools.parseProject", () => parseProject()),
    vscode.commands.registerCommand("dbtCoreTools.cleanProject", () => cleanProject()),
    vscode.commands.registerCommand("dbtCoreTools.debugProject", () => debugProject()),
    vscode.commands.registerCommand("dbtCoreTools.retryProject", () => retryProject())
  );

  // Dispose discovery on deactivation.
  context.subscriptions.push({ dispose: () => _discovery?.dispose() });
}

export function deactivate(): void {
  // Cleanup handled via context.subscriptions above.
}

// ---------------------------------------------------------------------------
// Context key helpers
// ---------------------------------------------------------------------------

async function updateContextKeys(
  editor: vscode.TextEditor | undefined
): Promise<void> {
  if (!editor) {
    _activeProject = null;
    await setContextKeys(false, false, false);
    return;
  }

  const filePath = editor.document.uri.fsPath;
  _activeProject = _discovery ? _discovery.findProjectForFile(filePath) : null;

  const ext = filePath.split(".").pop()?.toLowerCase();
  const isSql = ext === "sql";
  const isYml = ext === "yml" || ext === "yaml";
  const inProject = _activeProject !== null;

  const isDbtSqlFile = isSql && inProject;
  const isDbtFile = (isSql || isYml) && inProject;
  const isDbtSqlFileWithSources =
    isDbtSqlFile && editor.document.getText().includes("source(");

  await setContextKeys(isDbtSqlFile, isDbtFile, isDbtSqlFileWithSources);

  // Lazy-load the manifest for the active project.
  if (_activeProject) {
    void _activeProject.ensureLoaded();
  }
}

async function setContextKeys(
  isDbtSqlFile: boolean,
  isDbtFile: boolean,
  isDbtSqlFileWithSources: boolean
): Promise<void> {
  await vscode.commands.executeCommand(
    "setContext",
    "dbtCoreTools.isDbtSqlFile",
    isDbtSqlFile
  );
  await vscode.commands.executeCommand(
    "setContext",
    "dbtCoreTools.isDbtFile",
    isDbtFile
  );
  await vscode.commands.executeCommand(
    "setContext",
    "dbtCoreTools.isDbtSqlFileWithSources",
    isDbtSqlFileWithSources
  );
}

// ---------------------------------------------------------------------------
// YAML schema registration
// ---------------------------------------------------------------------------

const DBT_YML_SCHEMA_URL =
  "https://raw.githubusercontent.com/dbt-labs/dbt-jsonschema/refs/tags/v1.11.0-a1/schemas/dbt_yml_files.json";

const EXCLUDED_YML_FILENAMES = new Set([
  "dbt_project.yml",
  "selectors.yml",
  "packages.yml",
]);

async function registerYamlSchema(): Promise<void> {
  const yamlExtension = vscode.extensions.getExtension("redhat.vscode-yaml");
  if (!yamlExtension) {
    return;
  }

  const yamlApi = await yamlExtension.activate();
  if (!yamlApi || !yamlApi.registerContributor) {
    return;
  }

  yamlApi.registerContributor(
    "dbt-core-tools",
    (resource: string) => {
      // resource is a URI string (file:// scheme).
      const filePath = vscode.Uri.parse(resource).fsPath;
      const fileName = filePath.split(/[\\/]/).pop() ?? "";

      // Only apply to .yml / .yaml files, excluding reserved dbt files.
      const ext = fileName.split(".").pop()?.toLowerCase();
      if ((ext !== "yml" && ext !== "yaml") || EXCLUDED_YML_FILENAMES.has(fileName)) {
        return undefined;
      }

      // Only apply when the file lives inside a discovered dbt project.
      if (!_discovery || !_discovery.findProjectForFile(filePath)) {
        return undefined;
      }

      return DBT_YML_SCHEMA_URL;
    },
    (_schemaUri: string) => {
      // Return null to let the YAML extension fetch the schema itself.
      return null;
    }
  );
}
