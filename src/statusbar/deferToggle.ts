/**
 * DeferToggle — status bar item that shows and toggles the defer state
 * for the active dbt project.
 *
 * Defer state is held in memory (not persisted). It defaults to `true` when
 * `dbtCoreTools.deferManifestPath` is configured for the project.
 */

import * as vscode from "vscode";
import { DbtProject } from "../core/project";

export class DeferToggle {
  private readonly _item: vscode.StatusBarItem;

  /** Runtime defer state per project name. */
  private readonly _state = new Map<string, boolean>();

  constructor() {
    this._item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      99
    );
    this._item.command = "dbtCoreTools.toggleDefer";
    this._item.tooltip =
      "Defer: when enabled, dbt re-uses a pre-built state manifest so only " +
      "changed models are executed. Click to toggle.";
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Updates the status bar label for the given project, or hides it. */
  update(project: DbtProject | null): void {
    if (!project) {
      this._item.hide();
      return;
    }

    const hasDeferPath = this._hasDeferManifestPath(project.name);
    if (!hasDeferPath) {
      this._item.text = "defer: n/a";
    } else {
      const on = this._getState(project.name);
      this._item.text = `defer: ${on ? "on" : "off"}`;
    }

    this._item.show();
  }

  /**
   * Flips the defer state for the project. If no `deferManifestPath` is
   * configured, opens the settings UI instead.
   */
  async toggle(project: DbtProject | null): Promise<void> {
    if (!project) {
      vscode.window.showWarningMessage(
        "dbt Core Tools: No active dbt project. Open a file inside a dbt project first."
      );
      return;
    }

    if (!this._hasDeferManifestPath(project.name)) {
      // Guide the user to configure a defer manifest path.
      await vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "dbtCoreTools.deferManifestPath"
      );
      return;
    }

    const current = this._getState(project.name);
    this._state.set(project.name, !current);
    this.update(project);
  }

  /**
   * Returns the current defer state for the project.
   * Used by command builders to decide whether to pass `--defer` / `--state`.
   */
  isDeferred(projectName: string): boolean {
    return this._getState(projectName);
  }

  dispose(): void {
    this._item.dispose();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _hasDeferManifestPath(projectName: string): boolean {
    const config = vscode.workspace.getConfiguration("dbtCoreTools");
    const map = config.get<Record<string, string>>("deferManifestPath", {});
    return Boolean(map[projectName]);
  }

  /**
   * Returns the current defer state, initialising it from settings if not yet set.
   */
  private _getState(projectName: string): boolean {
    if (!this._state.has(projectName)) {
      // Default to true when a defer manifest path is configured.
      const defaultOn = this._hasDeferManifestPath(projectName);
      this._state.set(projectName, defaultOn);
    }
    // Non-null assertion is safe — we just set it above.
    return this._state.get(projectName)!;
  }
}
