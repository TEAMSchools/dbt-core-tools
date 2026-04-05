/**
 * Model Preview Panel for dbt Core Tools.
 *
 * Runs `dbt show` for the active model and displays results in a webview panel.
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { buildDbtCommand, executeAndCapture } from "../../core/executor";
import { getActiveProject } from "../../extension";
import { getModelName, getCommandOptions } from "../../commands/modelCommands";

// ---------------------------------------------------------------------------
// Panel cache — one panel per model
// ---------------------------------------------------------------------------

/** Re-use an existing panel if the model name matches; otherwise replace it. */
let _panel: vscode.WebviewPanel | undefined;
let _panelModelName: string | undefined;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Shows (or reveals) the model preview panel for the currently active SQL file.
 */
export async function showModelPreview(
  context: vscode.ExtensionContext,
): Promise<void> {
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

  // --- create or reveal webview panel ---
  if (_panel && _panelModelName === modelName) {
    _panel.reveal(vscode.ViewColumn.Two);
  } else {
    // Dispose old panel if it exists for a different model
    _panel?.dispose();

    _panel = vscode.window.createWebviewPanel(
      "dbtCoreTools.preview",
      `dbt show: ${modelName}`,
      vscode.ViewColumn.Two,
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(
            context.extensionUri,
            "src",
            "features",
            "preview",
            "webview",
          ),
        ],
      },
    );
    _panelModelName = modelName;

    // Clean up reference when panel is closed
    _panel.onDidDispose(() => {
      _panel = undefined;
      _panelModelName = undefined;
    });

    // Handle messages from the webview (e.g. copy to clipboard)
    _panel.webview.onDidReceiveMessage(async (message) => {
      if (message?.type === "copy" && typeof message.text === "string") {
        await vscode.env.clipboard.writeText(message.text);
        vscode.window.showInformationMessage(
          "dbt Core Tools: Error copied to clipboard.",
        );
      }
    });

    // Load and inject HTML
    _panel.webview.html = buildWebviewHtml(context, _panel.webview);
  }

  // --- run dbt show ---
  const result = await executeAndCapture(command, project.rootPath);

  if (result.exitCode !== 0) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getOutputChannel } =
        require("../../extension") as typeof import("../../extension");
      getOutputChannel().appendLine(
        `[error] dbt show failed for ${modelName}: ${result.stderr || result.stdout}`,
      );
    } catch {
      // Extension not activated; skip.
    }
    _panel.webview.postMessage({
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
    _panel.webview.postMessage({
      type: "error",
      modelName,
      command,
      error:
        result.stdout || result.stderr || "dbt show returned no tabular output.",
    });
    return;
  }

  _panel.webview.postMessage({ type: "results", columns, rows, modelName });
}

// ---------------------------------------------------------------------------
// HTML builder
// ---------------------------------------------------------------------------

function buildWebviewHtml(
  context: vscode.ExtensionContext,
  webview: vscode.Webview,
): string {
  const webviewDir = vscode.Uri.joinPath(
    context.extensionUri,
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
    context.extensionPath,
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

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parses the markdown-style table produced by `dbt show` stdout.
 *
 * Expected format:
 *   | col1 | col2 |
 *   | ---- | ---- |   ← separator, index 1 — skipped
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
   * e.g. "| foo | bar |" → ["foo", "bar"]
   */
  const parseLine = (line: string): string[] =>
    line
      .split("|")
      .slice(1, -1) // drop empty first/last segments from leading/trailing `|`
      .map((c) => c.trim());

  const columns = parseLine(tableLines[0]);

  // tableLines[1] is the separator row (e.g. "| ---- | ---- |") — skip it
  const dataLines = tableLines.slice(2);
  const rows = dataLines.map(parseLine);

  return { columns, rows };
}
