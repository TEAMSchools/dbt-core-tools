/**
 * DbtDefinitionProvider — Go-to-definition for ref(), source(), and macros
 * in dbt SQL files.
 */

import * as path from "path";
import * as vscode from "vscode";
import { getDiscovery } from "../extension";
import { findRefAtPosition, findSourceAtPosition } from "../utils/patterns";

export class DbtDefinitionProvider implements vscode.DefinitionProvider {
  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position
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
        const absPath = path.join(project.rootPath, node.original_file_path);
        return new vscode.Location(
          vscode.Uri.file(absPath),
          new vscode.Position(0, 0)
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
          const absPath = path.join(project.rootPath, source.original_file_path);
          return new vscode.Location(
            vscode.Uri.file(absPath),
            new vscode.Position(0, 0)
          );
        }
      }
    }

    // Check word at position against macros
    const wordRange = document.getWordRangeAtPosition(position);
    if (wordRange) {
      const word = document.getText(wordRange);
      const macros = project.getMacros();
      for (const macro of Object.values(macros)) {
        if (macro.name === word) {
          const absPath = path.join(project.rootPath, macro.original_file_path);
          return new vscode.Location(
            vscode.Uri.file(absPath),
            new vscode.Position(0, 0)
          );
        }
      }
    }

    return null;
  }
}
