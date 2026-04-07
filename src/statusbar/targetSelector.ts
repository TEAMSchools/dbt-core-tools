/**
 * TargetSelector — status bar item that shows the active dbt target
 * and lets the user pick a different one via a quick-pick menu.
 */

import * as path from "path";
import * as os from "os";
import * as vscode from "vscode";
import { DbtProject } from "../core/project";
import { parseProfileTargets } from "../core/profiles";
import { resolveWorkspacePath } from "../commands/modelCommands";

// ---------------------------------------------------------------------------
// In-memory target storage (resets on window reload)
// ---------------------------------------------------------------------------

const _selectedTargets = new Map<string, string>();

/** Returns the in-memory selected target for a project, or undefined if unset. */
export function getSelectedTarget(projectName: string): string | undefined {
  return _selectedTargets.get(projectName);
}

/** Sets (or clears when undefined) the in-memory target for a project. */
export function setSelectedTarget(
  projectName: string,
  target: string | undefined,
): void {
  if (target === undefined) {
    _selectedTargets.delete(projectName);
  } else {
    _selectedTargets.set(projectName, target);
  }
}

export class TargetSelector {
  private readonly _item: vscode.StatusBarItem;

  constructor() {
    this._item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100,
    );
    this._item.command = "dbtCoreTools.selectTarget";
    this._item.tooltip = "Click to change dbt target";
  }

  /** Updates the status bar label for the given project, or hides it. */
  update(project: DbtProject | null): void {
    if (!project) {
      this._item.hide();
      return;
    }

    const target = getSelectedTarget(project.name) ?? "default";

    this._item.text = `${project.name} | dbt: ${target}`;
    this._item.show();
  }

  /**
   * Shows a quick-pick of available targets for the project and stores
   * the selection in memory (resets on window reload).
   */
  async selectTarget(project: DbtProject | null): Promise<void> {
    if (!project) {
      vscode.window.showWarningMessage(
        "dbt Core Tools: No active dbt project. Open a file inside a dbt project first.",
      );
      return;
    }

    const config = vscode.workspace.getConfiguration("dbtCoreTools");
    const rawProfilesDir = config.get<string>("profilesDir", "") || undefined;
    const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
    const profilesDir =
      resolveWorkspacePath(rawProfilesDir, wsRoot) ??
      path.join(os.homedir(), ".dbt");
    const profilesPath = path.join(profilesDir, "profiles.yml");

    const { targets, defaultTarget } = parseProfileTargets(
      profilesPath,
      project.profileName,
    );

    if (targets.length === 0) {
      vscode.window.showWarningMessage(
        `dbt Core Tools: No targets found for profile "${project.profileName}" in ${profilesPath}.`,
      );
      return;
    }

    // Build quick-pick items, marking the default target.
    const items: vscode.QuickPickItem[] = targets.map((t) => ({
      label: t,
      description: t === defaultTarget ? "(default)" : undefined,
    }));

    const picked = await vscode.window.showQuickPick(items, {
      title: `Select dbt target for "${project.name}"`,
      placeHolder: "Choose a target",
    });

    if (!picked) {
      return;
    }

    setSelectedTarget(project.name, picked.label);
    this.update(project);
  }

  dispose(): void {
    this._item.dispose();
  }
}
