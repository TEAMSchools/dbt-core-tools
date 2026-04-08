/**
 * Feature 4 — Toggle SQL/Properties
 *
 * Provides scaffoldYaml() for creating new properties files, and
 * toggleProperties() for switching between .sql and .yml files.
 *
 * vscode and extension are NOT imported at the top level so that
 * scaffoldYaml() can be loaded and tested without the VS Code runtime.
 */

import * as path from "path";
import * as fs from "fs";
import { safeJoinPath, parsePatchPath } from "../utils/paths";

// Lazy type references — never imported at module load time.
// eslint-disable-next-line @typescript-eslint/no-require-imports
type VsCode = typeof import("vscode");
type DbtProject = import("../core/project").DbtProject;

// ---------------------------------------------------------------------------
// scaffoldYaml — pure, no vscode dependency
// ---------------------------------------------------------------------------

/**
 * Returns a YAML string for a new dbt properties file with the given model
 * name and optional list of column names. No description keys are emitted.
 */
export function scaffoldYaml(modelName: string, columns: string[]): string {
  const lines: string[] = [];
  lines.push("version: 2");
  lines.push("");
  lines.push("models:");
  lines.push(`  - name: ${modelName}`);

  if (columns.length > 0) {
    lines.push("    columns:");
    for (const col of columns) {
      lines.push(`      - name: ${col}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// toggleProperties — requires vscode runtime
// ---------------------------------------------------------------------------

/**
 * Toggles between a dbt .sql model file and its corresponding .yml properties
 * file. Behaviour differs based on which file is currently active:
 *
 * From .sql → .yml:
 *   - If the manifest has a patch_path, open that file and scroll to the model.
 *   - Otherwise scaffold a new .yml in the same directory.
 *
 * From .yml → .sql:
 *   - Find the nearest `- name:` entry above the cursor and open that model's
 *     .sql file via original_file_path from the manifest.
 */
export async function toggleProperties(): Promise<void> {
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

  const filePath = editor.document.uri.fsPath;
  const ext = filePath.split(".").pop()?.toLowerCase();

  if (ext === "sql") {
    await _sqlToProperties(vscode, editor, project, filePath);
  } else if (ext === "yml" || ext === "yaml") {
    await _propertiesToSql(vscode, editor, project);
  } else {
    vscode.window.showWarningMessage(
      "dbt Core Tools: Toggle Properties only works with .sql or .yml files.",
    );
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function _sqlToProperties(
  vscode: VsCode,
  editor: import("vscode").TextEditor,
  project: DbtProject,
  filePath: string,
): Promise<void> {
  const fileName = filePath.split(/[\\/]/).pop() ?? "";
  const modelName = fileName.replace(/\.sql$/i, "");

  if (!modelName) {
    vscode.window.showWarningMessage(
      "dbt Core Tools: Could not determine model name from file.",
    );
    return;
  }

  const node = project.findNodeByName(modelName);

  if (node?.patch_path) {
    const patchRelative = parsePatchPath(node.patch_path);
    const patchAbsPath = safeJoinPath(project.rootPath, patchRelative);
    if (!patchAbsPath) {
      vscode.window.showWarningMessage(
        "dbt Core Tools: Properties file path escapes the project directory.",
      );
      return;
    }

    const doc = await vscode.workspace.openTextDocument(patchAbsPath);
    const editorYml = await vscode.window.showTextDocument(doc);
    const text = doc.getText();
    const idx = text.indexOf(`- name: ${modelName}`);
    if (idx >= 0) {
      const pos = doc.positionAt(idx);
      editorYml.revealRange(
        new vscode.Range(pos, pos),
        vscode.TextEditorRevealType.InCenter,
      );
      editorYml.selection = new vscode.Selection(pos, pos);
    }
  } else {
    // Scaffold a new .yml file.
    const dir = path.dirname(filePath);
    const config = vscode.workspace.getConfiguration("dbtCoreTools");
    const location = config.get<string>("propertiesLocation", "folder");

    let ymlPath: string;
    if (location === "folder") {
      const propsDir = path.join(dir, "properties");
      if (!fs.existsSync(propsDir)) {
        await fs.promises.mkdir(propsDir, { recursive: true });
      }
      ymlPath = path.join(propsDir, `${modelName}.yml`);
    } else {
      ymlPath = path.join(dir, `${modelName}.yml`);
    }

    const columnNames = node ? Object.keys(node.columns) : [];
    const content = scaffoldYaml(modelName, columnNames);

    await fs.promises.writeFile(ymlPath, content, "utf8");

    const doc = await vscode.workspace.openTextDocument(ymlPath);
    await vscode.window.showTextDocument(doc);
  }
}

async function _propertiesToSql(
  vscode: VsCode,
  editor: import("vscode").TextEditor,
  project: DbtProject,
): Promise<void> {
  const doc = editor.document;
  const cursorLine = editor.selection.active.line;
  const text = doc.getText();
  const lines = text.split("\n");

  // Search backwards from the cursor line for `- name: <modelName>`.
  let modelName: string | null = null;
  for (let i = cursorLine; i >= 0; i--) {
    const match = /^\s*-\s+name:\s+(\S+)/.exec(lines[i]);
    if (match) {
      modelName = match[1];
      break;
    }
  }

  if (!modelName) {
    vscode.window.showWarningMessage(
      "dbt Core Tools: Could not find a `- name:` entry above the cursor.",
    );
    return;
  }

  const node = project.findNodeByName(modelName);
  if (!node) {
    vscode.window.showWarningMessage(
      `dbt Core Tools: Model "${modelName}" not found in manifest. Run dbt parse first.`,
    );
    return;
  }

  const sqlAbsPath = path.isAbsolute(node.original_file_path)
    ? node.original_file_path
    : safeJoinPath(project.rootPath, node.original_file_path);
  if (!sqlAbsPath) {
    vscode.window.showWarningMessage(
      "dbt Core Tools: Model file path escapes the project directory.",
    );
    return;
  }

  const sqlDoc = await vscode.workspace.openTextDocument(sqlAbsPath);
  await vscode.window.showTextDocument(sqlDoc);
}
