/**
 * Stage External Sources command for dbt Core Tools.
 *
 * Runs `dbt run-operation stage_external_sources` for the active project.
 * When a SQL file is active, scopes the operation to the sources referenced
 * in that file via --args 'select: src_a src_b'.
 */

import * as vscode from "vscode";
import {
  buildDbtCommand,
  executeInTerminal,
  resolveDbtExecutable,
} from "../core/executor";
import { getActiveProject } from "../extension";
import { extractSourceCalls } from "../utils/patterns";

/**
 * Stages external sources for the active dbt project.
 *
 * - Reads `stageExternalSourcesVars` from settings and interpolates
 *   `${projectName}` in each value.
 * - If a SQL file is active, scopes staging to the sources referenced in
 *   that file via `--args 'select: source_a source_b'`.
 * - If no SQL file is active, stages all sources (no --args flag).
 */
export async function stageExternalSources(): Promise<void> {
  const project = getActiveProject();
  if (!project) {
    vscode.window.showWarningMessage(
      "dbt Core Tools: No active dbt project. Open a file inside a dbt project first.",
    );
    return;
  }

  const config = vscode.workspace.getConfiguration("dbtCoreTools");
  const rawDbtCommand = config.get<string>("dbtCommand", "dbt");
  const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
  const dbtCommand = resolveDbtExecutable(rawDbtCommand, wsRoot);
  const profilesDir = config.get<string>("profilesDir", "") || undefined;
  const varsConfig = config.get<Record<string, string>>(
    "stageExternalSourcesVars",
    {},
  );

  // Interpolate ${projectName} in each var value.
  const interpolatedVars: Record<string, string> = {};
  for (const [key, value] of Object.entries(varsConfig)) {
    interpolatedVars[key] = value.replace(/\$\{projectName\}/g, project.name);
  }

  // Build --vars string: '{key1: value1, key2: value2}'
  let varsString: string | undefined;
  if (Object.keys(interpolatedVars).length > 0) {
    const pairs = Object.entries(interpolatedVars)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ");
    varsString = `'{${pairs}}'`;
  }

  // Build --args string from source calls in the active SQL editor (if any).
  let argsString: string | undefined;
  const editor = vscode.window.activeTextEditor;
  if (editor && editor.document.uri.fsPath.endsWith(".sql")) {
    const sql = editor.document.getText();
    const sourceCalls = extractSourceCalls(sql);
    if (sourceCalls.length > 0) {
      // Collect unique source names (not table names).
      const uniqueSourceNames = [
        ...new Set(sourceCalls.map((s) => s.sourceName)),
      ];
      argsString = `'select: ${uniqueSourceNames.join(" ")}'`;
    }
  }

  const command = buildDbtCommand({
    dbtCommand,
    subcommand: "run-operation stage_external_sources",
    projectDir: project.rootPath,
    profilesDir,
    vars: varsString,
    args: argsString,
  });

  executeInTerminal(command, project.name);
}
