/**
 * Parse-on-Save — Feature 2 (background component)
 *
 * Listens for `.sql` file saves inside a dbt project and runs
 * `dbt parse` in the background so the manifest stays fresh.
 * If a parse is already in-flight for that project it is cancelled first.
 */

import * as vscode from "vscode";
import { spawn, ChildProcess } from "child_process";
import { buildDbtCommand, splitCommand } from "../core/executor";
import { getDiscovery, getOutputChannel } from "../extension";
import { resolveWorkspacePath } from "../commands/modelCommands";

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
export function registerParseOnSave(context: vscode.ExtensionContext): void {
  const disposable = vscode.workspace.onDidSaveTextDocument((document) => {
    void handleSave(document);
  });
  context.subscriptions.push(disposable);
}

// ---------------------------------------------------------------------------
// Internal handler
// ---------------------------------------------------------------------------

async function handleSave(document: vscode.TextDocument): Promise<void> {
  // Only process .sql files.
  const filePath = document.uri.fsPath;
  if (!filePath.endsWith(".sql")) {
    return;
  }

  // Check the parseOnSave setting.
  const config = vscode.workspace.getConfiguration("dbtCoreTools");
  const parseOnSave = config.get<boolean>("parseOnSave", true);
  if (!parseOnSave) {
    return;
  }

  // Find the project that owns this file.
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

  // Cancel any in-flight parse for this project.
  const existing = _runningParses.get(project.name);
  if (existing && !existing.killed) {
    try {
      existing.kill("SIGINT");
    } catch {
      // Process may have already exited; ignore.
    }
    _runningParses.delete(project.name);
  }

  // Build the parse command.
  const dbtCommand = config.get<string>("dbtCommand", "dbt");
  const rawProfilesDir = config.get<string>("profilesDir", "");
  const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
  const profilesDir =
    resolveWorkspacePath(rawProfilesDir || undefined, wsRoot) ?? "";

  const cmd = buildDbtCommand({
    dbtCommand,
    subcommand: "parse",
    projectDir: project.rootPath,
    profilesDir: profilesDir || undefined,
  });

  const [executable, ...args] = splitCommand(cmd);
  if (!executable) {
    return;
  }

  // Spawn the parse process in the background.
  const child = spawn(executable, args, {
    cwd: project.rootPath,
    stdio: "ignore",
    detached: false,
  });

  _runningParses.set(project.name, child);

  child.on("close", () => {
    // Clean up after the process exits (only if it's still the current one).
    if (_runningParses.get(project.name) === child) {
      _runningParses.delete(project.name);
    }

    // Once parse finishes, compile if a compiled SQL document is open.
    // Compile must run AFTER parse — both write to manifest.json, and
    // dbt parse does NOT populate compiled_code (see CLAUDE.md gotchas).
    spawnCompileIfNeeded(filePath, dbtCommand, project.rootPath, profilesDir);
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

function spawnCompileIfNeeded(
  filePath: string,
  dbtCommand: string,
  projectRoot: string,
  profilesDir: string,
): void {
  const fileName = filePath.split(/[\\/]/).pop() ?? "";
  const modelName = fileName.replace(/\.sql$/i, "");
  if (!modelName) {
    return;
  }

  const hasOpenCompiledDoc = vscode.workspace.textDocuments.some(
    (doc) =>
      doc.uri.scheme === "dbt-compiled" &&
      new URLSearchParams(doc.uri.query).get("model") === modelName,
  );

  if (!hasOpenCompiledDoc) {
    return;
  }

  const compileCmd = buildDbtCommand({
    dbtCommand,
    subcommand: "compile",
    projectDir: projectRoot,
    selector: modelName,
    profilesDir: profilesDir || undefined,
  });

  const [compileExe, ...compileArgs] = splitCommand(compileCmd);
  if (!compileExe) {
    return;
  }

  // Cancel any in-flight compile for this model.
  const existing = _runningCompiles.get(modelName);
  if (existing && !existing.killed) {
    try {
      existing.kill("SIGINT");
    } catch {
      // Process may have already exited; ignore.
    }
  }

  const compileChild = spawn(compileExe, compileArgs, {
    cwd: projectRoot,
    stdio: "ignore",
    detached: false,
  });
  _runningCompiles.set(modelName, compileChild);

  compileChild.on("close", () => {
    if (_runningCompiles.get(modelName) === compileChild) {
      _runningCompiles.delete(modelName);
    }
  });
  compileChild.on("error", () => {
    if (_runningCompiles.get(modelName) === compileChild) {
      _runningCompiles.delete(modelName);
    }
  });
}
