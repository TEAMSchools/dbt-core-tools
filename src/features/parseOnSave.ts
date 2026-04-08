/**
 * Parse-on-Save — Feature 2 (background component)
 *
 * Listens for `.sql` file saves inside a dbt project and runs
 * `dbt parse` in the background so the manifest stays fresh.
 * If a parse is already in-flight for that project it is cancelled first.
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

/** Map from project.name → running dbt parse child process. */
const _runningParses = new Map<string, ChildProcess>();

/** Map from modelName → running dbt compile child process. */
const _runningCompiles = new Map<string, ChildProcess>();

/**
 * Returns a promise that resolves when any in-flight parse for the given
 * project finishes. Resolves immediately if no parse is running.
 */
export function waitForParse(projectName: string): Promise<void> {
  const child = _runningParses.get(projectName);
  if (!child || child.exitCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, 30_000);
    const done = () => {
      clearTimeout(timeout);
      resolve();
    };
    child.on("close", done);
    child.on("error", done);
  });
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Registers the on-save listener. Should be called once during `activate()`.
 * The returned disposable is pushed into `context.subscriptions`.
 */
export function registerParseOnSave(
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
  if (!config.get<boolean>("parseOnSave", true)) {
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

  // Fast path: if the compiled SQL panel is open, skip parse and go straight
  // to compile (saves one full process startup on every save).
  const modelName = modelNameFromPath(filePath);
  if (modelName && compiledSqlProvider.isOpen) {
    compiledSqlProvider.setModel(project.name, modelName);
    cancelParse(project.name);
    spawnCompile(modelName, project, compiledSqlProvider);
    return;
  }

  // Normal path: parse first, then compile if the panel is open.
  const { dbtCommand, profilesDir } = getCommandOptions(project.name);

  cancelParse(project.name);

  const cmd = buildDbtCommand({
    dbtCommand,
    subcommand: "parse",
    projectDir: project.rootPath,
    profilesDir,
  });

  const [executable, ...args] = splitCommand(cmd);
  if (!executable) {
    return;
  }

  const child = spawn(executable, args, {
    cwd: project.rootPath,
    stdio: "ignore",
    detached: false,
  });

  _runningParses.set(project.name, child);

  child.on("close", () => {
    if (_runningParses.get(project.name) === child) {
      _runningParses.delete(project.name);
    }

    // Compile must run AFTER parse — both write to manifest.json, and
    // dbt parse does NOT populate compiled_code (see CLAUDE.md gotchas).
    if (compiledSqlProvider.isOpen) {
      const name = modelNameFromPath(filePath);
      if (name) {
        cancelParse(project.name);
        spawnCompile(name, project, compiledSqlProvider);
      }
    }
  });

  child.on("error", (err) => {
    try {
      getOutputChannel().appendLine(
        `[error] dbt parse spawn failed for ${project.name}: ${err}`,
      );
    } catch {
      // Extension not activated; skip.
    }
    if (_runningParses.get(project.name) === child) {
      _runningParses.delete(project.name);
    }
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cancelParse(projectName: string): void {
  const existing = _runningParses.get(projectName);
  if (existing && !existing.killed) {
    try {
      existing.kill("SIGINT");
    } catch {
      // Process may have already exited; ignore.
    }
    _runningParses.delete(projectName);
  }
}

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
  compileChild.on("error", () => {
    if (_runningCompiles.get(modelName) === compileChild) {
      _runningCompiles.delete(modelName);
    }
    void manifestStatus?.clearRunning(project);
  });
}
