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
  buildModel,
  testModel,
  showModel,
  setPreviewProvider,
} from "./commands/modelCommands";
import { stageExternalSources } from "./commands/stageExternal";
import { initExecutor } from "./core/executor";
import { TargetSelector } from "./statusbar/targetSelector";
import { DeferToggle } from "./statusbar/deferToggle";
import { ManifestStatus } from "./statusbar/manifestStatus";
import { CompiledSqlProvider, showCompiledSql } from "./features/compiledSql";
import { registerCompileOnSave, spawnCompile } from "./features/compileOnSave";
import { DbtDefinitionProvider } from "./features/definition";
import { DbtHoverProvider } from "./features/hover";
import { DbtCompletionProvider } from "./features/completion";
import { toggleProperties } from "./features/properties";
import { syncColumns } from "./features/columnSync";
import { LineageViewProvider } from "./features/lineage/lineagePanel";
import { PreviewViewProvider } from "./features/preview/previewPanel";
import { modelNameFromPath } from "./utils/paths";

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let _discovery: ProjectDiscovery | null = null;
let _activeProject: DbtProject | null = null;
let _outputChannel: vscode.OutputChannel | null = null;

let _compiledSqlProvider: CompiledSqlProvider | null = null;
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

export function getOutputChannel(): vscode.OutputChannel {
  if (!_outputChannel) {
    throw new Error("dbt Core Tools: extension not yet activated");
  }
  return _outputChannel;
}

export function getCompiledSqlProvider(): CompiledSqlProvider | null {
  return _compiledSqlProvider;
}

export function getManifestStatus(): ManifestStatus | null {
  return _manifestStatus;
}

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  // Initialize the task-based command executor.
  initExecutor(context);

  _outputChannel = vscode.window.createOutputChannel("dbt Core Tools");
  context.subscriptions.push(_outputChannel);

  _discovery = new ProjectDiscovery();

  // Instantiate status bar items.
  _targetSelector = new TargetSelector();
  _deferToggle = new DeferToggle();
  _manifestStatus = new ManifestStatus();

  // Discover projects in the workspace.
  await _discovery.discover();

  // Register lineage view provider (declared early so the editor-change
  // handler below can reference it without a temporal dead zone risk).
  const lineageProvider = new LineageViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      LineageViewProvider.viewType,
      lineageProvider,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
  );

  // Register preview view provider.
  const previewProvider = new PreviewViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      PreviewViewProvider.viewType,
      previewProvider,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
  );

  setPreviewProvider(previewProvider);

  // Set initial context keys and lazy-load for whatever is open on startup.
  await updateContextKeys(vscode.window.activeTextEditor);

  // React to editor focus changes.
  let lineageDebounce: ReturnType<typeof setTimeout> | undefined;
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(async (editor) => {
      await updateContextKeys(editor);
      await updateStatusBar();
      clearTimeout(lineageDebounce);
      lineageDebounce = setTimeout(() => lineageProvider.updateCenter(), 150);

      // Update compiled SQL panel to follow the active editor.
      if (compiledSqlProvider.isOpen && editor) {
        const { scheme, fsPath } = editor.document.uri;
        if (scheme === "file" && fsPath.endsWith(".sql")) {
          const model = modelNameFromPath(fsPath);
          const project = _discovery?.findProjectForFile(fsPath) ?? null;
          if (model && project) {
            compiledSqlProvider.setModel(project.name, model);
            // Auto-compile if compiled_code is missing for the new model.
            const node = project.findNodeByName(model);
            if (!node || !node.compiled_code) {
              spawnCompile(model, project, compiledSqlProvider);
            }
          }
        }
      }
    }),
  );

  // Register YAML schema for dbt yml files via the Red Hat YAML extension.
  await registerYamlSchema();

  // Register lifecycle commands.
  context.subscriptions.push(
    vscode.commands.registerCommand("dbtCoreTools.setupProject", () =>
      setupProject(),
    ),
    vscode.commands.registerCommand("dbtCoreTools.setupAllProjects", () =>
      setupAllProjects(),
    ),
    vscode.commands.registerCommand("dbtCoreTools.installDeps", () =>
      installDeps(),
    ),
    vscode.commands.registerCommand("dbtCoreTools.parseProject", () =>
      parseProject(),
    ),
    vscode.commands.registerCommand("dbtCoreTools.cleanProject", () =>
      cleanProject(),
    ),
    vscode.commands.registerCommand("dbtCoreTools.debug", () => debugProject()),
    vscode.commands.registerCommand("dbtCoreTools.retry", () => retryProject()),
  );

  // Register model commands.
  context.subscriptions.push(
    vscode.commands.registerCommand("dbtCoreTools.runModel", () => runModel()),
    vscode.commands.registerCommand("dbtCoreTools.buildModel", () =>
      buildModel(),
    ),
    vscode.commands.registerCommand("dbtCoreTools.testModel", () =>
      testModel(),
    ),
    vscode.commands.registerCommand("dbtCoreTools.showModel", () =>
      showModel(),
    ),
  );

  // Register source staging command.
  context.subscriptions.push(
    vscode.commands.registerCommand("dbtCoreTools.stageExternalSources", () =>
      stageExternalSources(),
    ),
  );

  // Register lineage command to focus the panel.
  context.subscriptions.push(
    vscode.commands.registerCommand("dbtCoreTools.showLineage", () =>
      vscode.commands.executeCommand("dbtCoreTools.lineageView.focus"),
    ),
  );

  // Register properties and column sync commands.
  context.subscriptions.push(
    vscode.commands.registerCommand("dbtCoreTools.toggleProperties", () =>
      toggleProperties(),
    ),
    vscode.commands.registerCommand("dbtCoreTools.syncColumns", () =>
      syncColumns(),
    ),
  );

  // Register status bar commands.
  context.subscriptions.push(
    vscode.commands.registerCommand("dbtCoreTools.selectTarget", () =>
      _targetSelector!.selectTarget(_activeProject),
    ),
    vscode.commands.registerCommand("dbtCoreTools.toggleDefer", () =>
      _deferToggle!.toggle(_activeProject),
    ),
  );

  // Register compiled SQL provider and command.
  _compiledSqlProvider = new CompiledSqlProvider();
  const compiledSqlProvider = _compiledSqlProvider;
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      "dbt-compiled",
      compiledSqlProvider,
    ),
    vscode.commands.registerCommand("dbtCoreTools.showCompiledSql", () =>
      showCompiledSql(compiledSqlProvider),
    ),
  );

  // Reset compiled SQL state when its virtual document is closed.
  // Use a short delay because setTextDocumentLanguage fires close+open in
  // quick succession — clearing immediately would kill the tracking state.
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((doc) => {
      if (doc.uri.scheme === "dbt-compiled") {
        setTimeout(() => {
          const stillOpen = vscode.workspace.textDocuments.some(
            (d) => d.uri.scheme === "dbt-compiled",
          );
          if (!stillOpen) {
            compiledSqlProvider.clearModel();
          }
        }, 100);
      }
    }),
  );

  // Wire manifest change events: refresh compiled SQL + lineage.
  for (const project of _discovery.projects) {
    const disposer = project.onManifestChanged(() => {
      if (compiledSqlProvider.isOpen) {
        compiledSqlProvider.fireChange();
      }
      lineageProvider.refreshGraph();
    });
    context.subscriptions.push({ dispose: disposer });
  }

  // Register parse-on-save background runner.
  registerCompileOnSave(context, compiledSqlProvider);

  // Register definition, hover, and completion providers.
  const dbtDocumentSelector: vscode.DocumentSelector = [
    { language: "sql", scheme: "file" },
    { language: "jinja-sql", scheme: "file" },
  ];
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(
      dbtDocumentSelector,
      new DbtDefinitionProvider(),
    ),
    vscode.languages.registerHoverProvider(
      dbtDocumentSelector,
      new DbtHoverProvider(),
    ),
    vscode.languages.registerCompletionItemProvider(
      dbtDocumentSelector,
      new DbtCompletionProvider(),
      "(",
      "{",
      "%",
    ),
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
  editor: vscode.TextEditor | undefined,
): Promise<void> {
  if (!editor) {
    _activeProject = null;
    await setContextKeys(false, false, false);
    return;
  }

  const filePath = editor.document.uri.fsPath;
  _activeProject = _discovery ? _discovery.findProjectForFile(filePath) : null;

  const ext = filePath.split(".").pop()?.toLowerCase();
  const languageId = editor.document.languageId;
  const isSql = ext === "sql" || languageId === "jinja-sql";
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
  isDbtSqlFileWithSources: boolean,
): Promise<void> {
  await vscode.commands.executeCommand(
    "setContext",
    "dbtCoreTools.isDbtSqlFile",
    isDbtSqlFile,
  );
  await vscode.commands.executeCommand(
    "setContext",
    "dbtCoreTools.isDbtFile",
    isDbtFile,
  );
  await vscode.commands.executeCommand(
    "setContext",
    "dbtCoreTools.isDbtSqlFileWithSources",
    isDbtSqlFileWithSources,
  );
}

// ---------------------------------------------------------------------------
// YAML schema registration
// ---------------------------------------------------------------------------

const DBT_YML_SCHEMA_URL =
  "https://raw.githubusercontent.com/dbt-labs/dbt-jsonschema/main/schemas/latest/dbt_yml_files-latest.json";

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
      if (
        (ext !== "yml" && ext !== "yaml") ||
        EXCLUDED_YML_FILENAMES.has(fileName)
      ) {
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
    },
  );
}
