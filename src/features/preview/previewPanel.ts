/**
 * Model Preview Panel for dbt Core Tools.
 *
 * Runs `dbt show` for the active model and displays results in a persistent
 * WebviewView (bottom Panel area), following the same pattern as the lineage panel.
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { buildDbtCommand, executeAndCapture } from "../../core/executor";
import { getActiveProject, getOutputChannel } from "../../extension";
import { getModelName, getCommandOptions } from "../../commands/modelCommands";

// ---------------------------------------------------------------------------
// PreviewViewProvider
// ---------------------------------------------------------------------------

export class PreviewViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "dbtCoreTools.previewView";

  private _view: vscode.WebviewView | undefined;
  private _ready = false;
  private _pendingMessage: unknown | null = null;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this._view = webviewView;
    this._ready = false;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(
          this._extensionUri,
          "src",
          "features",
          "preview",
          "webview",
        ),
      ],
    };

    webviewView.webview.html = this._buildHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (message?.type === "ready") {
        this._ready = true;
        if (this._pendingMessage) {
          webviewView.webview.postMessage(this._pendingMessage);
          this._pendingMessage = null;
        }
        return;
      }
      if (message?.type === "copy" && typeof message.text === "string") {
        await vscode.env.clipboard.writeText(message.text);
        vscode.window.showInformationMessage(
          "dbt Core Tools: Error copied to clipboard.",
        );
      }
    });
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Runs `dbt show` for the active model and posts results to the webview.
   */
  async showPreview(): Promise<void> {
    // --- resolve project / model ---
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

    // --- focus the panel ---
    if (this._view) {
      this._view.show(true);
    }

    // --- post loading message ---
    this._postMessage({ type: "loading", modelName });

    // --- settings ---
    const config = vscode.workspace.getConfiguration("dbtCoreTools");
    const showLimit = config.get<number>("showLimit", 5);
    const { dbtCommand, target, profilesDir, deferState } = getCommandOptions(
      project.name,
    );

    // --- build command ---
    const command = buildDbtCommand({
      dbtCommand,
      subcommand: "show",
      projectDir: project.rootPath,
      selector: modelName,
      target,
      profilesDir,
      deferState,
      limit: showLimit,
    });

    // --- run dbt show ---
    const result = await executeAndCapture(command, project.rootPath);

    if (result.exitCode !== 0) {
      try {
        getOutputChannel().appendLine(
          `[error] dbt show failed for ${modelName}: ${result.stderr || result.stdout}`,
        );
      } catch {
        // Extension not activated; skip.
      }
      this._postMessage({
        type: "error",
        modelName,
        command,
        error:
          result.stderr ||
          result.stdout ||
          "dbt show failed with a non-zero exit code.",
      });
      return;
    }

    // --- parse markdown table from stdout ---
    const { columns, rows } = parseDbtShowOutput(result.stdout);

    if (columns.length === 0) {
      this._postMessage({
        type: "error",
        modelName,
        command,
        error:
          result.stdout ||
          result.stderr ||
          "dbt show returned no tabular output.",
      });
      return;
    }

    this._postMessage({ type: "results", columns, rows, modelName });
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private _postMessage(message: unknown): void {
    if (!this._view) return;
    if (!this._ready) {
      this._pendingMessage = message;
      return;
    }
    this._view.webview.postMessage(message);
  }

  private _buildHtml(webview: vscode.Webview): string {
    const webviewDir = vscode.Uri.joinPath(
      this._extensionUri,
      "src",
      "features",
      "preview",
      "webview",
    );

    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(webviewDir, "styles.css"),
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(webviewDir, "main.js"),
    );
    const cspSource = webview.cspSource;

    // Generate a random nonce for CSP
    const nonce = crypto.randomBytes(16).toString("hex");

    const htmlPath = path.join(
      this._extensionUri.fsPath,
      "src",
      "features",
      "preview",
      "webview",
      "index.html",
    );

    let html = fs.readFileSync(htmlPath, "utf8");
    html = html
      .replace(/\{\{styleUri\}\}/g, styleUri.toString())
      .replace(/\{\{scriptUri\}\}/g, scriptUri.toString())
      .replace(/\{\{cspSource\}\}/g, cspSource)
      .replace(/\{\{nonce\}\}/g, nonce);

    return html;
  }
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parses the markdown-style table produced by `dbt show` stdout.
 *
 * Expected format:
 *   | col1 | col2 |
 *   | ---- | ---- |   <- separator, index 1 -- skipped
 *   | val1 | val2 |
 */
export function parseDbtShowOutput(stdout: string): {
  columns: string[];
  rows: string[][];
} {
  const tableLines = stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("|"));

  if (tableLines.length === 0) {
    return { columns: [], rows: [] };
  }

  /**
   * Splits a pipe-delimited table line into trimmed cell values.
   * e.g. "| foo | bar |" -> ["foo", "bar"]
   */
  const parseLine = (line: string): string[] =>
    line
      .split("|")
      .slice(1, -1) // drop empty first/last segments from leading/trailing `|`
      .map((c) => c.trim());

  const columns = parseLine(tableLines[0]);

  // tableLines[1] is the separator row (e.g. "| ---- | ---- |") -- skip it
  const dataLines = tableLines.slice(2);
  const rows = dataLines.map(parseLine);

  return { columns, rows };
}
