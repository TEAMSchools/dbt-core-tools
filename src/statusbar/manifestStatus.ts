/**
 * ManifestStatus — status bar item that shows when the manifest was last parsed,
 * and temporarily displays a running indicator while a dbt command is in flight.
 */

import * as vscode from "vscode";
import { DbtProject } from "../core/project";

export class ManifestStatus {
  private readonly _item: vscode.StatusBarItem;

  /** Whether the item is currently showing a running animation. */
  private _isRunning = false;

  constructor() {
    this._item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      98
    );
    this._item.command = "dbtCoreTools.parseProject";
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Shows the manifest mtime for the given project, or hides if none. */
  async update(project: DbtProject | null): Promise<void> {
    // Don't overwrite a running indicator.
    if (this._isRunning) {
      return;
    }

    if (!project) {
      this._item.hide();
      return;
    }

    const mtime = await project.getManifestMtime();
    if (!mtime) {
      this._item.text = "parsed: never";
      this._item.tooltip = "Manifest has not been generated yet. Click to run dbt parse.";
    } else {
      const timeStr = mtime.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      this._item.text = `parsed: ${timeStr}`;
      this._item.tooltip = `Manifest last parsed at ${mtime.toLocaleString()}. Click to re-parse.`;
    }

    this._item.show();
  }

  /**
   * Shows a spinning indicator with a label while a dbt command runs.
   * Call `clearRunning` when the command finishes.
   */
  setRunning(label: string): void {
    this._isRunning = true;
    this._item.text = `$(sync~spin) dbt: ${label}...`;
    this._item.tooltip = undefined;
    this._item.show();
  }

  /**
   * Reverts to the normal timestamp display after a command finishes.
   */
  async clearRunning(project: DbtProject | null): Promise<void> {
    this._isRunning = false;
    await this.update(project);
  }

  dispose(): void {
    this._item.dispose();
  }
}
