/**
 * Model commands for dbt Core Tools.
 *
 * Provides run/build/test/show commands, each with and without the options picker.
 */

import * as vscode from "vscode";
import { buildDbtCommand, executeInTerminal } from "../core/executor";
import { getActiveProject } from "../extension";
import { buildSelector, showOptionsPicker, PickerOptions } from "./optionsPicker";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extracts the model name from the active SQL editor's filename (sans extension).
 * Shows a warning and returns null if no SQL file is active.
 */
export function getModelName(): string | null {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage(
      "dbt Core Tools: No active editor. Open a dbt SQL file first."
    );
    return null;
  }

  const filePath = editor.document.uri.fsPath;
  if (!filePath.endsWith(".sql")) {
    vscode.window.showWarningMessage(
      "dbt Core Tools: Active file is not a SQL file."
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
  const profilesDir = config.get<string>("profilesDir", "") || undefined;
  const target = config.get<Record<string, string>>("target", {})[projectName];
  const deferManifestPath = config.get<Record<string, string>>("deferManifestPath", {})[projectName];

  return {
    dbtCommand,
    target,
    profilesDir,
    deferState: deferManifestPath || undefined,
  };
}

// ---------------------------------------------------------------------------
// Central command runner
// ---------------------------------------------------------------------------

/**
 * Central helper that resolves the model/project, optionally shows the options
 * picker, builds the dbt command, and executes it in a terminal.
 *
 * @param subcommand  The dbt subcommand (e.g. "run", "build", "test").
 * @param withOptions Whether to show the options picker before running.
 */
export async function runModelCommand(
  subcommand: string,
  withOptions: boolean
): Promise<void> {
  const project = getActiveProject();
  if (!project) {
    vscode.window.showWarningMessage(
      "dbt Core Tools: No active dbt project. Open a file inside a dbt project first."
    );
    return;
  }

  const modelName = getModelName();
  if (!modelName) {
    return;
  }

  let pickerOptions: PickerOptions = {};
  if (withOptions) {
    const result = await showOptionsPicker();
    if (result === undefined) {
      // User cancelled
      return;
    }
    pickerOptions = result;
  }

  const selector = buildSelector(modelName, pickerOptions);
  const { dbtCommand, target, profilesDir, deferState } = getCommandOptions(project.name);

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

/** Runs `dbt run` for the active model. */
export const runModel = (): Promise<void> => runModelCommand("run", false);

/** Runs `dbt run` with the options picker. */
export const runModelOptions = (): Promise<void> => runModelCommand("run", true);

/** Runs `dbt build` for the active model. */
export const buildModel = (): Promise<void> => runModelCommand("build", false);

/** Runs `dbt build` with the options picker. */
export const buildModelOptions = (): Promise<void> => runModelCommand("build", true);

/** Runs `dbt test` for the active model. */
export const testModel = (): Promise<void> => runModelCommand("test", false);

/** Runs `dbt test` with the options picker. */
export const testModelOptions = (): Promise<void> => runModelCommand("test", true);

/**
 * Stub for showing a model preview.
 * Full implementation in Task 13.
 */
export function showModel(): void {
  vscode.window.showInformationMessage("dbt Core Tools: Model preview not yet available.");
}
