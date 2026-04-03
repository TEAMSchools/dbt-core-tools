/**
 * DbtCompletionProvider — Autocomplete for ref(), source(), macros, and
 * config() keys in dbt SQL files.
 */

import * as vscode from "vscode";
import { getDiscovery } from "../extension";

const CONFIG_KEYS = [
  "materialized",
  "schema",
  "alias",
  "tags",
  "enabled",
  "pre_hook",
  "post_hook",
  "persist_docs",
  "full_refresh",
  "unique_key",
  "strategy",
  "updated_at",
  "on_schema_change",
  "grant_access_to",
  "hours_to_expiration",
  "partition_by",
  "cluster_by",
  "require_partition_filter",
];

export class DbtCompletionProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.CompletionItem[] {
    const project = getDiscovery().findProjectForFile(document.uri.fsPath);
    if (!project) {
      return [];
    }

    const lineText = document.lineAt(position).text;
    const textBeforeCursor = lineText.substring(0, position.character);

    // ref( — return model names
    if (/ref\s*\(\s*['"]?$/.test(textBeforeCursor)) {
      const nodes = project.getNodes();
      return Object.values(nodes).map((node) => {
        const item = new vscode.CompletionItem(
          node.name,
          vscode.CompletionItemKind.Reference,
        );
        item.detail = node.resource_type;
        return item;
      });
    }

    // source( with first arg already filled — return table names for that source
    const sourceTableMatch = /source\s*\(\s*['"](\w+)['"]\s*,\s*['"]?$/.exec(
      textBeforeCursor,
    );
    if (sourceTableMatch) {
      const sourceName = sourceTableMatch[1];
      const sources = project.getSources();
      return Object.values(sources)
        .filter((s) => s.source_name === sourceName)
        .map(
          (s) =>
            new vscode.CompletionItem(s.name, vscode.CompletionItemKind.Field),
        );
    }

    // source( — return unique source names
    if (/source\s*\(\s*['"]?$/.test(textBeforeCursor)) {
      const sources = project.getSources();
      const seen = new Set<string>();
      const items: vscode.CompletionItem[] = [];
      for (const source of Object.values(sources)) {
        if (!seen.has(source.source_name)) {
          seen.add(source.source_name);
          items.push(
            new vscode.CompletionItem(
              source.source_name,
              vscode.CompletionItemKind.Module,
            ),
          );
        }
      }
      return items;
    }

    // {{ — return macro names
    if (/\{\{\s*$/.test(textBeforeCursor)) {
      const macros = project.getMacros();
      return Object.values(macros).map((macro) => {
        const item = new vscode.CompletionItem(
          macro.name,
          vscode.CompletionItemKind.Function,
        );
        item.detail = macro.package_name;
        return item;
      });
    }

    // config( — return static config keys
    if (/config\s*\(\s*$/.test(textBeforeCursor)) {
      return CONFIG_KEYS.map(
        (key) =>
          new vscode.CompletionItem(key, vscode.CompletionItemKind.Property),
      );
    }

    return [];
  }
}
