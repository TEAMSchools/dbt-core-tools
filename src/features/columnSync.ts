/**
 * Feature 4 — Column Sync
 *
 * syncColumns() diffs the manifest node's columns against the existing YAML
 * properties file, adds new columns (with upstream descriptions where available),
 * and marks removed columns with a comment.
 *
 * vscode and extension are NOT imported at the top level so that the module
 * can be loaded without the VS Code runtime if needed.
 */

import * as path from "path";
import * as fs from "fs";

// Lazy type references — never imported at module load time.
type VsCode = typeof import("vscode");
type DbtProject = import("../core/project").DbtProject;

// ---------------------------------------------------------------------------
// syncColumns — main entry point
// ---------------------------------------------------------------------------

export async function syncColumns(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const vscode = require("vscode") as VsCode;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getActiveProject } =
    require("../extension") as typeof import("../extension");

  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage(
      "dbt Core Tools: No active editor. Open a dbt SQL or YAML file first.",
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

  // Step 1: resolve model name.
  const modelName = _resolveModelName(editor);
  if (!modelName) {
    vscode.window.showWarningMessage(
      "dbt Core Tools: Could not determine model name. Open a .sql file or position cursor near a `- name:` entry in a .yml file.",
    );
    return;
  }

  // Step 2: find node in manifest.
  const node = project.findNodeByName(modelName);
  if (!node) {
    vscode.window.showWarningMessage(
      `dbt Core Tools: Model "${modelName}" not found in manifest. Run dbt parse first.`,
    );
    return;
  }

  // Step 3: contract check.
  if (node.contract?.enforced) {
    const manifestColNames = Object.keys(node.columns);
    const confirmation = await vscode.window.showWarningMessage(
      `dbt Core Tools: Model "${modelName}" has an enforced contract. ` +
        `Manifest columns: [${manifestColNames.join(", ")}]. Continue?`,
      { modal: true },
      "Continue",
    );
    if (confirmation !== "Continue") {
      return;
    }
  }

  // Step 4: find the YAML file via patch_path.
  if (!node.patch_path) {
    vscode.window.showWarningMessage(
      `dbt Core Tools: Model "${modelName}" has no properties file. Use Toggle Properties to create one first.`,
    );
    return;
  }

  const patchRelative = node.patch_path.replace(/^[^/]+:\/\//, "");
  const ymlPath = path.join(project.rootPath, patchRelative);

  // Step 5: parse existing columns from the YAML (line-based).
  let ymlContent: string;
  try {
    ymlContent = await fs.promises.readFile(ymlPath, "utf8");
  } catch {
    vscode.window.showWarningMessage(
      `dbt Core Tools: Could not read properties file at ${ymlPath}.`,
    );
    return;
  }

  const existingColumns = _parseYamlColumns(ymlContent, modelName);

  // Step 6: compute diff.
  const manifestColNames = new Set(
    Object.keys(node.columns).map((k) => k.toLowerCase()),
  );
  const existingColNames = new Set(existingColumns.map((c) => c.toLowerCase()));

  const newCols = [...manifestColNames].filter((c) => !existingColNames.has(c));
  const removedCols = [...existingColNames].filter(
    (c) => !manifestColNames.has(c),
  );

  if (newCols.length === 0 && removedCols.length === 0) {
    vscode.window.showInformationMessage(
      `dbt Core Tools: "${modelName}" columns are already in sync.`,
    );
    return;
  }

  // Step 7: description propagation for new columns.
  const descriptions = new Map<string, string>();
  for (const colName of newCols) {
    const desc = _findUpstreamDescription(
      colName,
      node.depends_on.nodes,
      project,
    );
    if (desc) {
      descriptions.set(colName, desc);
    }
  }

  // Steps 8 & 9: apply edits to the YAML content.
  const updatedContent = _applyColumnDiff(
    ymlContent,
    modelName,
    newCols,
    removedCols,
    descriptions,
  );

  // Step 10: write and open.
  await fs.promises.writeFile(ymlPath, updatedContent, "utf8");
  const doc = await vscode.workspace.openTextDocument(ymlPath);
  await vscode.window.showTextDocument(doc);

  vscode.window.showInformationMessage(
    `dbt Core Tools: Synced "${modelName}" — ${newCols.length} added, ${removedCols.length} marked removed.`,
  );
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Derive model name from the active editor (SQL filename or YAML cursor). */
function _resolveModelName(editor: import("vscode").TextEditor): string | null {
  const filePath = editor.document.uri.fsPath;
  const ext = filePath.split(".").pop()?.toLowerCase();

  if (ext === "sql") {
    const fileName = filePath.split(/[\\/]/).pop() ?? "";
    return fileName.replace(/\.sql$/i, "") || null;
  }

  if (ext === "yml" || ext === "yaml") {
    const doc = editor.document;
    const cursorLine = editor.selection.active.line;
    const lines = doc.getText().split("\n");

    for (let i = cursorLine; i >= 0; i--) {
      const match = /^\s*-\s+name:\s+(\S+)/.exec(lines[i]);
      if (match) {
        return match[1];
      }
    }
  }

  return null;
}

/**
 * Line-based YAML column parser.
 * Finds the model entry, then finds the `columns:` section beneath it,
 * and collects `- name:` entries until the section ends.
 */
export function _parseYamlColumns(
  ymlContent: string,
  modelName: string,
): string[] {
  const lines = ymlContent.split("\n");
  const columns: string[] = [];

  // Find the model entry line.
  let modelLineIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*-\s+name:\s+/.test(lines[i])) {
      const match = /^\s*-\s+name:\s+(\S+)/.exec(lines[i]);
      if (match && match[1] === modelName) {
        modelLineIdx = i;
        break;
      }
    }
  }

  if (modelLineIdx < 0) {
    return columns;
  }

  // Find the `columns:` section under this model entry.
  const modelIndent = _indentOf(lines[modelLineIdx]);
  let columnsLineIdx = -1;

  for (let i = modelLineIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === "") {
      continue;
    }
    const indent = _indentOf(line);
    if (indent <= modelIndent && trimmed !== "") {
      break;
    }
    if (trimmed === "columns:") {
      columnsLineIdx = i;
      break;
    }
  }

  if (columnsLineIdx < 0) {
    return columns;
  }

  const columnsIndent = _indentOf(lines[columnsLineIdx]);

  // Collect `- name:` entries within the columns section.
  for (let i = columnsLineIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === "") {
      continue;
    }
    const indent = _indentOf(line);
    if (indent <= columnsIndent && trimmed !== "") {
      break;
    }
    const match = /^\s*-\s+name:\s+(\S+)/.exec(line);
    if (match) {
      columns.push(match[1]);
    }
  }

  return columns;
}

/** Returns the number of leading spaces in a string. */
function _indentOf(line: string): number {
  const match = /^(\s*)/.exec(line);
  return match ? match[1].length : 0;
}

/**
 * Searches upstream model nodes for a column with a non-empty description.
 * Returns the first description found, or null.
 */
function _findUpstreamDescription(
  colName: string,
  upstreamNodeIds: string[],
  project: DbtProject,
): string | null {
  const allNodes = project.getNodes();
  for (const nodeId of upstreamNodeIds) {
    const upstreamNode = allNodes[nodeId];
    if (!upstreamNode) {
      continue;
    }
    for (const [key, col] of Object.entries(upstreamNode.columns)) {
      if (key.toLowerCase() === colName.toLowerCase() && col.description) {
        return col.description;
      }
    }
  }
  return null;
}

/**
 * Applies the column diff to the YAML string.
 * - Inserts new column entries at the end of the columns section.
 * - Appends `# REMOVED: not in manifest` comment to removed column lines.
 */
export function _applyColumnDiff(
  ymlContent: string,
  modelName: string,
  newCols: string[],
  removedCols: string[],
  descriptions: Map<string, string>,
): string {
  const lines = ymlContent.split("\n");

  // Mark removed columns.
  const removedSet = new Set(removedCols.map((c) => c.toLowerCase()));
  for (let i = 0; i < lines.length; i++) {
    const match = /^\s*-\s+name:\s+(\S+)/.exec(lines[i]);
    if (match && removedSet.has(match[1].toLowerCase())) {
      if (!lines[i].includes("# REMOVED")) {
        lines[i] = lines[i] + "  # REMOVED: not in manifest";
      }
    }
  }

  if (newCols.length === 0) {
    return lines.join("\n");
  }

  // Find the model entry line to determine column indentation.
  let modelLineIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const match = /^\s*-\s+name:\s+(\S+)/.exec(lines[i]);
    if (match && match[1] === modelName) {
      modelLineIdx = i;
      break;
    }
  }

  if (modelLineIdx < 0) {
    // Fallback: just append to end.
    for (const col of newCols) {
      lines.push(`      - name: ${col}`);
    }
    return lines.join("\n");
  }

  const modelIndent = _indentOf(lines[modelLineIdx]);
  // Column entries are at modelIndent + 6 (e.g. model at 2 → columns at 4 → entries at 6).
  const colEntryIndent = " ".repeat(modelIndent + 6);
  const colSectionIndent = " ".repeat(modelIndent + 4);

  // Find end of existing columns section (or model block).
  let columnsLineIdx = -1;
  let insertIdx = -1;

  for (let i = modelLineIdx + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === "") {
      continue;
    }
    const indent = _indentOf(lines[i]);
    if (indent <= modelIndent && trimmed !== "") {
      break;
    }
    if (trimmed === "columns:") {
      columnsLineIdx = i;
    }
    if (columnsLineIdx >= 0) {
      const colMatch = /^\s*-\s+name:\s+/.test(lines[i]);
      if (colMatch && _indentOf(lines[i]) > _indentOf(lines[columnsLineIdx])) {
        insertIdx = i + 1;
      }
    }
  }

  const newColLines: string[] = newCols.map((col) => {
    const desc = descriptions.get(col);
    if (desc) {
      return `${colEntryIndent}- name: ${col}\n${colEntryIndent}  description: "${desc}"`;
    }
    return `${colEntryIndent}- name: ${col}`;
  });

  if (columnsLineIdx >= 0 && insertIdx >= 0) {
    // Insert after the last existing column entry.
    lines.splice(insertIdx, 0, ...newColLines);
  } else if (columnsLineIdx >= 0) {
    // columns: section exists but has no entries yet.
    lines.splice(columnsLineIdx + 1, 0, ...newColLines);
  } else {
    // No columns: section — find the end of the model block and add one.
    let modelBlockEnd = modelLineIdx + 1;
    for (let i = modelLineIdx + 1; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed === "") {
        continue;
      }
      const indent = _indentOf(lines[i]);
      if (indent <= modelIndent) {
        break;
      }
      modelBlockEnd = i + 1;
    }
    const columnsSectionLines = [`${colSectionIndent}columns:`, ...newColLines];
    lines.splice(modelBlockEnd, 0, ...columnsSectionLines);
  }

  return lines.join("\n");
}
