/**
 * DbtHoverProvider — Shows column info for ref() and source() references
 * in dbt SQL files.
 */

import * as vscode from "vscode";
import { getDiscovery } from "../extension";
import { findRefAtPosition, findSourceAtPosition } from "../utils/patterns";
import { ManifestColumn } from "../core/project";

function formatColumnsTable(columns: Record<string, ManifestColumn>): vscode.Hover {
  const lines = ["| Column | Type | Description |", "| --- | --- | --- |"];
  for (const col of Object.values(columns)) {
    lines.push(`| ${col.name} | ${col.data_type ?? ""} | ${col.description ?? ""} |`);
  }
  return new vscode.Hover(new vscode.MarkdownString(lines.join("\n")));
}

export class DbtHoverProvider implements vscode.HoverProvider {
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.Hover | null {
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
      if (node && Object.keys(node.columns).length > 0) {
        return formatColumnsTable(node.columns);
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
          if (Object.keys(source.columns).length > 0) {
            return formatColumnsTable(source.columns);
          }
          break;
        }
      }
    }

    return null;
  }
}
