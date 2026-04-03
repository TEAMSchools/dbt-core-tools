/**
 * TargetSelector — status bar item that shows the active dbt target
 * and lets the user pick a different one via a quick-pick menu.
 */

import * as path from "path";
import * as os from "os";
import * as vscode from "vscode";
import { DbtProject } from "../core/project";
import { parseProfileTargets } from "../core/profiles";

export class TargetSelector {
  private readonly _item: vscode.StatusBarItem;

  constructor() {
    this._item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
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

    const config = vscode.workspace.getConfiguration("dbtCoreTools");
    const targetMap = config.get<Record<string, string>>("target", {});
    const target = targetMap[project.name] ?? "default";

    this._item.text = `${project.name} | dbt: ${target}`;
    this._item.show();
  }

  /**
   * Shows a quick-pick of available targets for the project and persists
   * the selection to `dbtCoreTools.target` in workspace settings.
   */
  async selectTarget(project: DbtProject | null): Promise<void> {
    if (!project) {
      vscode.window.showWarningMessage(
        "dbt Core Tools: No active dbt project. Open a file inside a dbt project first."
      );
      return;
    }

    const config = vscode.workspace.getConfiguration("dbtCoreTools");
    const profilesDir =
      config.get<string>("profilesDir", "") || path.join(os.homedir(), ".dbt");
    const profilesPath = path.join(profilesDir, "profiles.yml");

    const { targets, defaultTarget } = parseProfileTargets(
      profilesPath,
      project.name
    );

    if (targets.length === 0) {
      vscode.window.showWarningMessage(
        `dbt Core Tools: No targets found for profile "${project.name}" in ${profilesPath}.`
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

    // Merge the selection into the existing target map.
    const existing = config.get<Record<string, string>>("target", {});
    await config.update(
      "target",
      { ...existing, [project.name]: picked.label },
      vscode.ConfigurationTarget.Workspace
    );

    this.update(project);
  }

  dispose(): void {
    this._item.dispose();
  }
}
