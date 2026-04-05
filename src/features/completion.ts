/**
 * DbtCompletionProvider — Autocomplete for ref(), source(), macros, and
 * config() keys in dbt SQL files.
 */

import * as vscode from "vscode";
import { getDiscovery } from "../extension";

export const DBT_BUILT_IN_FUNCTIONS = [
  { name: "ref", detail: "dbt built-in" },
  { name: "source", detail: "dbt built-in" },
  { name: "config", detail: "dbt built-in" },
  { name: "var", detail: "dbt built-in" },
  { name: "env_var", detail: "dbt built-in" },
  { name: "log", detail: "dbt built-in" },
  { name: "return", detail: "dbt built-in" },
  { name: "is_incremental", detail: "dbt built-in" },
  { name: "this", detail: "dbt built-in" },
  { name: "set", detail: "Jinja built-in" },
  { name: "if", detail: "Jinja built-in" },
  { name: "for", detail: "Jinja built-in" },
  { name: "macro", detail: "Jinja built-in" },
  { name: "block", detail: "Jinja built-in" },
  { name: "do", detail: "Jinja built-in" },
];

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

    // {{ or {{- — return macro names + dbt/Jinja built-in functions
    if (/\{\{-?\s*$/.test(textBeforeCursor)) {
      const items: vscode.CompletionItem[] = [];

      // Built-in functions first
      for (const fn of DBT_BUILT_IN_FUNCTIONS) {
        const item = new vscode.CompletionItem(
          fn.name,
          vscode.CompletionItemKind.Function,
        );
        item.detail = fn.detail;
        item.sortText = `0_${fn.name}`;
        items.push(item);
      }

      // Manifest macros
      const macros = project.getMacros();
      for (const macro of Object.values(macros)) {
        const item = new vscode.CompletionItem(
          macro.name,
          vscode.CompletionItemKind.Function,
        );
        item.detail = macro.package_name;
        item.sortText = `1_${macro.name}`;
        items.push(item);
      }

      return items;
    }

    // {% or {%- — return Jinja tag keywords
    if (/\{%-?\s*$/.test(textBeforeCursor)) {
      const tagKeywords = ["if", "for", "set", "macro", "block", "filter", "call", "raw", "do"];
      return tagKeywords.map((kw) => {
        const item = new vscode.CompletionItem(
          kw,
          vscode.CompletionItemKind.Keyword,
        );
        item.detail = "Jinja tag";
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
