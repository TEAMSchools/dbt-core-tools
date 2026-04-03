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
import {
  runModel,
  runModelOptions,
  buildModel,
  buildModelOptions,
  testModel,
  testModelOptions,
  showModel,
} from "./commands/modelCommands";
import { stageExternalSources } from "./commands/stageExternal";
import { TargetSelector } from "./statusbar/targetSelector";
import { DeferToggle } from "./statusbar/deferToggle";
import { ManifestStatus } from "./statusbar/manifestStatus";
import { CompiledSqlProvider, showCompiledSql } from "./features/compiledSql";
import { registerParseOnSave } from "./features/parseOnSave";
import { DbtDefinitionProvider } from "./features/definition";
import { DbtHoverProvider } from "./features/hover";
import { DbtCompletionProvider } from "./features/completion";

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let _discovery: ProjectDiscovery | null = null;
let _activeProject: DbtProject | null = null;

let _targetSelector: TargetSelector | null = null;
let _deferToggle: DeferToggle | null = null;
let _manifestStatus: ManifestStatus | null = null;

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

export function getDeferToggle(): DeferToggle | null {
  return _deferToggle;
}

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  _discovery = new ProjectDiscovery();

  // Instantiate status bar items.
  _targetSelector = new TargetSelector();
  _deferToggle = new DeferToggle();
  _manifestStatus = new ManifestStatus();

  // Discover projects in the workspace.
  await _discovery.discover();

  // Set initial context keys and lazy-load for whatever is open on startup.
  await updateContextKeys(vscode.window.activeTextEditor);

  // React to editor focus changes.
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(async (editor) => {
      await updateContextKeys(editor);
      await updateStatusBar();
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

  // Register model commands.
  context.subscriptions.push(
    vscode.commands.registerCommand("dbtCoreTools.runModel", () => runModel()),
    vscode.commands.registerCommand("dbtCoreTools.runModelOptions", () => runModelOptions()),
    vscode.commands.registerCommand("dbtCoreTools.buildModel", () => buildModel()),
    vscode.commands.registerCommand("dbtCoreTools.buildModelOptions", () => buildModelOptions()),
    vscode.commands.registerCommand("dbtCoreTools.testModel", () => testModel()),
    vscode.commands.registerCommand("dbtCoreTools.testModelOptions", () => testModelOptions()),
    vscode.commands.registerCommand("dbtCoreTools.showModel", () => showModel())
  );

  // Register source staging command.
  context.subscriptions.push(
    vscode.commands.registerCommand("dbtCoreTools.stageExternalSources", () =>
      stageExternalSources()
    )
  );

  // Register status bar commands.
  context.subscriptions.push(
    vscode.commands.registerCommand("dbtCoreTools.selectTarget", () =>
      _targetSelector!.selectTarget(_activeProject)
    ),
    vscode.commands.registerCommand("dbtCoreTools.toggleDefer", () =>
      _deferToggle!.toggle(_activeProject)
    )
  );

  // Register compiled SQL provider and command.
  const compiledSqlProvider = new CompiledSqlProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      "dbt-compiled",
      compiledSqlProvider
    ),
    vscode.commands.registerCommand("dbtCoreTools.showCompiledSql", () =>
      showCompiledSql(compiledSqlProvider)
    )
  );

  // Wire manifest change events: refresh any open compiled SQL documents.
  for (const project of _discovery.projects) {
    const disposer = project.onManifestChanged(() => {
      for (const doc of vscode.workspace.textDocuments) {
        if (doc.uri.scheme !== "dbt-compiled") {
          continue;
        }
        const params = new URLSearchParams(doc.uri.query);
        if (params.get("project") === project.name) {
          compiledSqlProvider.fireChange(doc.uri);
        }
      }
    });
    context.subscriptions.push({ dispose: disposer });
  }

  // Register parse-on-save background runner.
  registerParseOnSave(context);

  // Register definition, hover, and completion providers.
  const dbtDocumentSelector: vscode.DocumentSelector = [
    { language: "sql", scheme: "file" },
    { language: "jinja-sql", scheme: "file" },
  ];
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(
      dbtDocumentSelector,
      new DbtDefinitionProvider()
    ),
    vscode.languages.registerHoverProvider(
      dbtDocumentSelector,
      new DbtHoverProvider()
    ),
    vscode.languages.registerCompletionItemProvider(
      dbtDocumentSelector,
      new DbtCompletionProvider(),
      "(",
      "{"
    )
  );

  // Push status bar items so they're disposed on deactivation.
  context.subscriptions.push(_targetSelector, _deferToggle, _manifestStatus);

  // Dispose discovery on deactivation.
  context.subscriptions.push({ dispose: () => _discovery?.dispose() });

  // Initial status bar update.
  await updateStatusBar();
}

export function deactivate(): void {
  // Cleanup handled via context.subscriptions above.
}

// ---------------------------------------------------------------------------
// Status bar helpers
// ---------------------------------------------------------------------------

async function updateStatusBar(): Promise<void> {
  _targetSelector?.update(_activeProject);
  _deferToggle?.update(_activeProject);
  await _manifestStatus?.update(_activeProject);
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
