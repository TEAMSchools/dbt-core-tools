/**
 * DbtDefinitionProvider — Go-to-definition for ref(), source(), and macros
 * in dbt SQL files.
 */

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { getDiscovery } from "../extension";
import { safeJoinPath } from "../utils/paths";
import {
  findRefAtPosition,
  findSourceAtPosition,
  findQualifiedMacroAtPosition,
} from "../utils/patterns";

function resolveMacroPath(
  project: import("../core/project").DbtProject,
  macro: { package_name: string; original_file_path: string },
): string | null {
  // Try direct resolution from project root
  let absPath = safeJoinPath(project.rootPath, macro.original_file_path);
  if (absPath && fs.existsSync(absPath)) {
    return absPath;
  }

  // Try via dbt_packages/<package>/<original_file_path>
  if (macro.package_name !== project.name) {
    absPath = safeJoinPath(
      project.rootPath,
      path.join("dbt_packages", macro.package_name, macro.original_file_path),
    );
    if (absPath && fs.existsSync(absPath)) {
      return absPath;
    }
  }

  return null;
}

export class DbtDefinitionProvider implements vscode.DefinitionProvider {
  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.Location | null {
    const project = getDiscovery().findProjectForFile(document.uri.fsPath);
    if (!project) {
      return null;
    }

    const lineText = document.lineAt(position).text;
    const character = position.character;

    // Check for ref() at position
    const refName = findRefAtPosition(lineText, character);
    if (refName) {
      const node = project.findNodeByName(refName);
      if (node) {
        const absPath = safeJoinPath(project.rootPath, node.original_file_path);
        if (!absPath) {
          return null;
        }
        return new vscode.Location(
          vscode.Uri.file(absPath),
          new vscode.Position(0, 0),
        );
      }
    }

    // Check for source() at position
    const sourceRef = findSourceAtPosition(lineText, character);
    if (sourceRef) {
      const sources = project.getSources();
      for (const source of Object.values(sources)) {
        if (
          source.source_name === sourceRef.sourceName &&
          source.name === sourceRef.tableName
        ) {
          const absPath = safeJoinPath(
            project.rootPath,
            source.original_file_path,
          );
          if (!absPath) {
            continue;
          }
          return new vscode.Location(
            vscode.Uri.file(absPath),
            new vscode.Position(0, 0),
          );
        }
      }
    }

    // Check for qualified macro reference (e.g. dbt_utils.union_relations)
    const qualifiedRef = findQualifiedMacroAtPosition(lineText, character);
    if (qualifiedRef) {
      const macros = project.getMacros();
      for (const macro of Object.values(macros)) {
        if (
          macro.package_name === qualifiedRef.packageName &&
          macro.name === qualifiedRef.macroName
        ) {
          const absPath = resolveMacroPath(project, macro);
          if (absPath) {
            return new vscode.Location(
              vscode.Uri.file(absPath),
              new vscode.Position(0, 0),
            );
          }
        }
      }
      // No macro matched — fall through to unqualified lookup so that
      // false positives (e.g. adapter.dispatch) don't block resolution.
    }

    // Check unqualified word against macros (prefer project macros)
    const wordRange = document.getWordRangeAtPosition(position);
    if (wordRange) {
      const word = document.getText(wordRange);
      const macros = project.getMacros();
      let projectMatch: vscode.Location | null = null;
      let packageMatch: vscode.Location | null = null;

      for (const macro of Object.values(macros)) {
        if (macro.name === word) {
          const absPath = resolveMacroPath(project, macro);
          if (!absPath) continue;
          const location = new vscode.Location(
            vscode.Uri.file(absPath),
            new vscode.Position(0, 0),
          );
          if (macro.package_name === project.name) {
            projectMatch = location;
          } else if (!packageMatch) {
            packageMatch = location;
          }
        }
      }

      return projectMatch ?? packageMatch ?? null;
    }

    return null;
  }
}
