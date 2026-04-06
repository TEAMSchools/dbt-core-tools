/**
 * Model commands for dbt Core Tools.
 *
 * Provides run/build/test/show commands with a two-step options picker.
 */

import * as path from "path";
import * as vscode from "vscode";
import { buildDbtCommand, executeInTerminal } from "../core/executor";
import { getActiveProject, getDeferToggle } from "../extension";
import { buildSelector, showOptionsPicker } from "./optionsPicker";

// ---------------------------------------------------------------------------
// Preview provider (set during activation)
// ---------------------------------------------------------------------------

let _previewProvider: { showPreview(): Promise<void> } | undefined;

/** Called from extension.ts activate() to wire the preview panel. */
export function setPreviewProvider(provider: {
  showPreview(): Promise<void>;
}): void {
  _previewProvider = provider;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolves a potentially relative path against the workspace root.
 * Returns undefined if the input is falsy.
 */
export function resolveWorkspacePath(
  inputPath: string | undefined,
  wsRoot: string,
): string | undefined {
  if (!inputPath) {
    return undefined;
  }
  return path.isAbsolute(inputPath)
    ? inputPath
    : path.resolve(wsRoot, inputPath);
}

/**
 * Extracts the model name from the active SQL editor's filename (sans extension).
 * Shows a warning and returns null if no SQL file is active.
 */
export function getModelName(): string | null {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage(
      "dbt Core Tools: No active editor. Open a dbt SQL file first.",
    );
    return null;
  }

  const filePath = editor.document.uri.fsPath;
  if (!filePath.endsWith(".sql")) {
    vscode.window.showWarningMessage(
      "dbt Core Tools: Active file is not a SQL file.",
    );
    return null;
  }

  // Extract filename without extension
  const fileName = filePath.split(/[\\/]/).pop() ?? "";
  return fileName.replace(/\.sql$/i, "");
}

/**
 * Reads dbt command settings from VS Code configuration for the given project.
 */
export function getCommandOptions(projectName: string): {
  dbtCommand: string;
  target: string | undefined;
  profilesDir: string | undefined;
  deferState: string | undefined;
} {
  const config = vscode.workspace.getConfiguration("dbtCoreTools");
  const dbtCommand = config.get<string>("dbtCommand", "dbt");
  const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
  const rawProfilesDir = config.get<string>("profilesDir", "") || undefined;
  const profilesDir = resolveWorkspacePath(rawProfilesDir, wsRoot);
  const target = config.get<Record<string, string>>("target", {})[projectName];

  // Only include deferState when the toggle is actually on.
  let deferState: string | undefined;
  const deferToggle = getDeferToggle();
  if (deferToggle && deferToggle.isDeferred(projectName)) {
    const deferManifestPath = config.get<Record<string, string>>(
      "deferManifestPath",
      {},
    )[projectName];
    if (deferManifestPath) {
      deferState = resolveWorkspacePath(deferManifestPath, wsRoot);
    }
  }

  return { dbtCommand, target, profilesDir, deferState };
}

// ---------------------------------------------------------------------------
// Central command runner
// ---------------------------------------------------------------------------

/**
 * Central helper that resolves the model/project, shows the two-step options
 * picker, builds the dbt command, and executes it in a terminal.
 *
 * @param subcommand  The dbt subcommand (e.g. "run", "build", "test").
 */
export async function runModelCommand(subcommand: string): Promise<void> {
  const project = getActiveProject();
  if (!project) {
    vscode.window.showWarningMessage(
      "dbt Core Tools: No active dbt project. Open a file inside a dbt project first.",
    );
    return;
  }

  const modelName = getModelName();
  if (!modelName) {
    return;
  }

  const pickerOptions = await showOptionsPicker(subcommand);
  if (pickerOptions === undefined) {
    return;
  }

  const selector = buildSelector(modelName, pickerOptions);
  const { dbtCommand, target, profilesDir, deferState } = getCommandOptions(
    project.name,
  );

  const command = buildDbtCommand({
    dbtCommand,
    subcommand,
    projectDir: project.rootPath,
    selector,
    target,
    profilesDir,
    deferState,
    fullRefresh: pickerOptions.fullRefresh,
  });

  executeInTerminal(command, project.name);
}

// ---------------------------------------------------------------------------
// Exported command handlers
// ---------------------------------------------------------------------------

export const runModel = (): Promise<void> => runModelCommand("run");
export const buildModel = (): Promise<void> => runModelCommand("build");
export const testModel = (): Promise<void> => runModelCommand("test");

/** Shows the model preview panel for the active SQL file. */
export async function showModel(): Promise<void> {
  if (!_previewProvider) {
    vscode.window.showErrorMessage(
      "dbt Core Tools: Preview provider not available. Please reload the window.",
    );
    return;
  }
  await _previewProvider.showPreview();
}
