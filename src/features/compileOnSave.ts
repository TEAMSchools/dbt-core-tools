/**
 * Compile-on-Save
 *
 * Listens for `.sql` file saves inside a dbt project and runs
 * `dbt compile -s <model>` in the background so the manifest stays
 * fresh (including compiled_code). If a compile is already in-flight
 * for that model it is cancelled first.
 *
 * `dbt compile` is a superset of `dbt parse` — it updates the full
 * manifest AND populates compiled_code, so there is no need for a
 * separate parse step.
 */

import * as vscode from "vscode";
import { spawn, ChildProcess } from "child_process";
import {
  buildDbtCommand,
  splitCommand,
} from "../core/executor";
import { getDiscovery, getManifestStatus, getOutputChannel } from "../extension";
import { getCommandOptions } from "../commands/modelCommands";
import { CompiledSqlProvider } from "./compiledSql";
import type { DbtProject } from "../core/project";
import { modelNameFromPath } from "../utils/paths";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Map from modelName → running dbt compile child process. */
const _runningCompiles = new Map<string, ChildProcess>();

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Registers the on-save listener. Should be called once during `activate()`.
 * The returned disposable is pushed into `context.subscriptions`.
 */
export function registerCompileOnSave(
  context: vscode.ExtensionContext,
  compiledSqlProvider: CompiledSqlProvider,
): void {
  const disposable = vscode.workspace.onDidSaveTextDocument((document) => {
    void handleSave(document, compiledSqlProvider);
  });
  context.subscriptions.push(disposable);
}

// ---------------------------------------------------------------------------
// Internal handler
// ---------------------------------------------------------------------------

async function handleSave(
  document: vscode.TextDocument,
  compiledSqlProvider: CompiledSqlProvider,
): Promise<void> {
  const filePath = document.uri.fsPath;
  if (!filePath.endsWith(".sql")) {
    return;
  }

  const config = vscode.workspace.getConfiguration("dbtCoreTools");
  if (!config.get<boolean>("compileOnSave", true)) {
    return;
  }

  let discovery;
  try {
    discovery = getDiscovery();
  } catch {
    return;
  }
  const project = discovery.findProjectForFile(filePath);
  if (!project) {
    return;
  }

  const modelName = modelNameFromPath(filePath);
  if (!modelName) {
    return;
  }

  if (compiledSqlProvider.isOpen) {
    compiledSqlProvider.setModel(project.name, modelName);
  }

  spawnCompile(modelName, project, compiledSqlProvider);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Spawns `dbt compile -s <modelName>`, cancelling any in-flight compile for
 * the same model. On completion, reloads the manifest directly (bypassing
 * the file-watcher debounce) and refreshes the compiled SQL panel.
 */
function spawnCompile(
  modelName: string,
  project: DbtProject,
  compiledSqlProvider: CompiledSqlProvider,
): void {
  // Cancel any in-flight compile for this model.
  const existing = _runningCompiles.get(modelName);
  if (existing && !existing.killed) {
    try {
      existing.kill("SIGINT");
    } catch {
      // Process may have already exited; ignore.
    }
  }

  const { dbtCommand, target, profilesDir, deferState } =
    getCommandOptions(project.name);

  const compileCmd = buildDbtCommand({
    dbtCommand,
    subcommand: "compile",
    projectDir: project.rootPath,
    selector: modelName,
    target,
    profilesDir,
    deferState,
  });

  const [compileExe, ...compileArgs] = splitCommand(compileCmd);
  if (!compileExe) {
    return;
  }

  const manifestStatus = getManifestStatus();
  manifestStatus?.setRunning(`compiling ${modelName}`);

  const compileChild = spawn(compileExe, compileArgs, {
    cwd: project.rootPath,
    stdio: "ignore",
    detached: false,
  });
  _runningCompiles.set(modelName, compileChild);

  compileChild.on("close", () => {
    if (_runningCompiles.get(modelName) === compileChild) {
      _runningCompiles.delete(modelName);
    }
    // Bypass the 500ms file-watcher debounce.
    void project.reloadManifest().then(() => {
      compiledSqlProvider.fireChange();
      void manifestStatus?.clearRunning(project);
    });
  });
  compileChild.on("error", (err) => {
    try {
      getOutputChannel().appendLine(
        `[error] dbt compile spawn failed for ${modelName}: ${err}`,
      );
    } catch {
      // Extension not activated; skip.
    }
    if (_runningCompiles.get(modelName) === compileChild) {
      _runningCompiles.delete(modelName);
    }
    void manifestStatus?.clearRunning(project);
  });
}
