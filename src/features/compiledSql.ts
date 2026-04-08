/**
 * Compiled SQL Viewer — Feature 2
 *
 * Provides a virtual document (dbt-compiled: scheme) that shows the
 * compiled SQL for the model open in the active editor. The panel
 * automatically follows the active editor — switching to a different
 * .sql file updates the compiled view without opening a new tab.
 */

import * as vscode from "vscode";
import {
  getActiveProject,
  getDiscovery,
  getManifestStatus,
  getOutputChannel,
} from "../extension";
import { buildDbtCommand, executeAndCapture } from "../core/executor";
import { getCommandOptions } from "../commands/modelCommands";
import { waitForParse } from "./parseOnSave";
import { modelNameFromPath } from "../utils/paths";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Fixed URI for the single compiled SQL virtual document. */
export const COMPILED_SQL_URI = vscode.Uri.parse("dbt-compiled:compiled.sql");

// ---------------------------------------------------------------------------
// CompiledSqlProvider
// ---------------------------------------------------------------------------

export class CompiledSqlProvider implements vscode.TextDocumentContentProvider {
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  private _modelName: string | null = null;
  private _projectName: string | null = null;

  get modelName(): string | null {
    return this._modelName;
  }

  /** Whether the compiled SQL panel is currently open. */
  get isOpen(): boolean {
    return this._modelName !== null;
  }

  /** Resets state when the compiled SQL document is closed. */
  clearModel(): void {
    this._modelName = null;
    this._projectName = null;
  }

  /**
   * Updates the model shown in the compiled SQL panel.
   * Fires a content change so VS Code re-fetches `provideTextDocumentContent`.
   */
  setModel(projectName: string, modelName: string): void {
    if (this._projectName === projectName && this._modelName === modelName) {
      return;
    }
    this._projectName = projectName;
    this._modelName = modelName;
    this._onDidChange.fire(COMPILED_SQL_URI);
  }

  /** Notifies VS Code to re-fetch the virtual document content. */
  fireChange(): void {
    this._onDidChange.fire(COMPILED_SQL_URI);
  }

  provideTextDocumentContent(_uri: vscode.Uri): string {
    if (!this._projectName || !this._modelName) {
      return "-- dbt Core Tools: no model selected";
    }

    // Find the project by name.
    let project = getActiveProject();
    if (!project || project.name !== this._projectName) {
      try {
        const discovery = getDiscovery();
        project =
          discovery.projects.find((p) => p.name === this._projectName) ?? null;
      } catch {
        project = null;
      }
    }

    if (!project) {
      return `-- dbt Core Tools: project "${this._projectName}" not found`;
    }

    const node = project.findNodeByName(this._modelName);
    if (!node) {
      return `-- dbt Core Tools: model "${this._modelName}" not found in manifest for project "${this._projectName}".\n-- Run dbt parse to populate the manifest.`;
    }

    if (!node.compiled_code) {
      return `-- dbt Core Tools: model "${this._modelName}" has no compiled SQL.\n-- Compiling... (if this persists, run dbt compile manually)`;
    }

    return node.compiled_code;
  }
}

// ---------------------------------------------------------------------------
// showCompiledSql command handler
// ---------------------------------------------------------------------------

/**
 * Opens (or refreshes) a side-by-side read-only view of the compiled SQL
 * for the model currently open in the active editor.
 */
export async function showCompiledSql(
  provider: CompiledSqlProvider,
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage(
      "dbt Core Tools: No active editor. Open a dbt SQL file first.",
    );
    return;
  }

  const filePath = editor.document.uri.fsPath;
  const ext = filePath.split(".").pop()?.toLowerCase();
  if (ext !== "sql") {
    vscode.window.showWarningMessage(
      "dbt Core Tools: Compiled SQL viewer only works with .sql files.",
    );
    return;
  }

  const project = getActiveProject();
  if (!project) {
    vscode.window.showWarningMessage(
      "dbt Core Tools: No active dbt project. Open a file inside a dbt project first.",
    );
    return;
  }

  const modelName = modelNameFromPath(filePath);
  if (!modelName) {
    vscode.window.showWarningMessage(
      "dbt Core Tools: Could not determine model name from file.",
    );
    return;
  }

  provider.setModel(project.name, modelName);

  const doc = await vscode.workspace.openTextDocument(COMPILED_SQL_URI);
  await vscode.window.showTextDocument(doc, {
    viewColumn: vscode.ViewColumn.Beside,
    preserveFocus: true,
  });
  await vscode.languages.setTextDocumentLanguage(doc, "sql");

  // Auto-compile if compiled_code is missing.
  const node = project.findNodeByName(modelName);
  if (!node || !node.compiled_code) {
    const { dbtCommand, target, profilesDir, deferState } = getCommandOptions(
      project.name,
    );

    const compileCmd = buildDbtCommand({
      dbtCommand,
      subcommand: "compile",
      projectDir: project.rootPath,
      selector: modelName,
      target,
      profilesDir,
      deferState,
    });

    const manifestStatus = getManifestStatus();
    manifestStatus?.setRunning(`compiling ${modelName}`);

    await waitForParse(project.name);
    const result = await executeAndCapture(compileCmd, project.rootPath);
    if (result.exitCode !== 0) {
      getOutputChannel().appendLine(
        `[error] dbt compile failed for ${modelName}: ${result.stderr || result.stdout}`,
      );
    }
    await project.reloadManifest();

    await manifestStatus?.clearRunning(project);
    provider.fireChange();
  }
}
