/**
 * Compiled SQL Viewer — Feature 2
 *
 * Provides a virtual document (dbt-compiled: scheme) that shows the
 * compiled SQL for the model open in the active editor.
 */

import * as vscode from "vscode";
import { getActiveProject, getDiscovery, getManifestStatus, getOutputChannel } from "../extension";
import { buildDbtCommand, executeAndCapture } from "../core/executor";
import { getCommandOptions } from "../commands/modelCommands";
import { waitForParse } from "./parseOnSave";

// ---------------------------------------------------------------------------
// CompiledSqlProvider
// ---------------------------------------------------------------------------

export class CompiledSqlProvider implements vscode.TextDocumentContentProvider {
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this._onDidChange.event;

  provideTextDocumentContent(uri: vscode.Uri): string {
    const params = new URLSearchParams(uri.query);
    const projectName = params.get("project");
    const modelName = params.get("model");

    if (!projectName || !modelName) {
      return "-- dbt Core Tools: invalid compiled SQL URI (missing project or model)";
    }

    // Find the project by name.
    let project = getActiveProject();
    if (!project || project.name !== projectName) {
      // Fall back to searching all discovered projects.
      try {
        const discovery = getDiscovery();
        project =
          discovery.projects.find((p) => p.name === projectName) ?? null;
      } catch {
        project = null;
      }
    }

    if (!project) {
      return `-- dbt Core Tools: project "${projectName}" not found`;
    }

    const node = project.findNodeByName(modelName);
    if (!node) {
      return `-- dbt Core Tools: model "${modelName}" not found in manifest for project "${projectName}".\n-- Run dbt parse to populate the manifest.`;
    }

    if (!node.compiled_code) {
      return `-- dbt Core Tools: model "${modelName}" has no compiled SQL.\n-- Compiling... (if this persists, run dbt compile manually)`;
    }

    return node.compiled_code;
  }

  /** Notifies VS Code to re-fetch the virtual document for this URI. */
  fireChange(uri: vscode.Uri): void {
    this._onDidChange.fire(uri);
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

  const fileName = filePath.split(/[\\/]/).pop() ?? "";
  const modelName = fileName.replace(/\.sql$/i, "");
  if (!modelName) {
    vscode.window.showWarningMessage(
      "dbt Core Tools: Could not determine model name from file.",
    );
    return;
  }

  const uri = vscode.Uri.parse(
    `dbt-compiled:${modelName}.compiled.sql?project=${encodeURIComponent(project.name)}&model=${encodeURIComponent(modelName)}`,
  );

  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc, {
    viewColumn: vscode.ViewColumn.Beside,
    preserveFocus: true,
  });
  await vscode.languages.setTextDocumentLanguage(doc, "sql");

  // Auto-compile if compiled_code is missing.
  const node = project.findNodeByName(modelName);
  if (!node || !node.compiled_code) {
    const { dbtCommand, target, profilesDir } = getCommandOptions(project.name);

    const compileCmd = buildDbtCommand({
      dbtCommand,
      subcommand: "compile",
      projectDir: project.rootPath,
      selector: modelName,
      target,
      profilesDir,
    });

    const manifestStatus = getManifestStatus();
    manifestStatus?.setRunning(`compiling ${modelName}`);

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `dbt Core Tools: Compiling ${modelName}...`,
        cancellable: false,
      },
      async () => {
        await waitForParse(project.name);
        const result = await executeAndCapture(compileCmd, project.rootPath);
        if (result.exitCode !== 0) {
          getOutputChannel().appendLine(
            `[error] dbt compile failed for ${modelName}: ${result.stderr || result.stdout}`,
          );
        }
        await project.reloadManifest();
      },
    );

    await manifestStatus?.clearRunning(project);
    provider.fireChange(uri);
  }
}
