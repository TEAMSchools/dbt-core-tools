import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext): void {
  console.log("dbt Core Tools activated");
}

export function deactivate(): void {
  // cleanup
}
