/**
 * Options picker for dbt model commands.
 *
 * Provides:
 * - buildSelector  — pure function that builds a dbt model selector string
 * - showOptionsPicker — vscode quick pick for Full Refresh, Upstream, Downstream
 */

// vscode is NOT imported at the top level so this module can be loaded
// in unit tests without the VS Code runtime present.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type VsCode = typeof import("vscode");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PickerOptions {
  fullRefresh?: boolean;
  upstream?: boolean;
  downstream?: boolean;
}

// ---------------------------------------------------------------------------
// Pure helper
// ---------------------------------------------------------------------------

/**
 * Builds a dbt selector string from a model name and upstream/downstream flags.
 * e.g. buildSelector("my_model", { upstream: true }) => "+my_model"
 */
export function buildSelector(
  modelName: string,
  options: PickerOptions,
): string {
  const prefix = options.upstream ? "+" : "";
  const suffix = options.downstream ? "+" : "";
  return `${prefix}${modelName}${suffix}`;
}

// ---------------------------------------------------------------------------
// VS Code quick pick
// ---------------------------------------------------------------------------

/**
 * Shows a canPickMany quick pick with Full Refresh, Upstream, and Downstream
 * options. Returns the selected options, or undefined if the user cancelled.
 */
export async function showOptionsPicker(): Promise<PickerOptions | undefined> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const vscode = require("vscode") as VsCode;

  const FULL_REFRESH = "Full Refresh";
  const UPSTREAM = "Upstream (+ prefix)";
  const DOWNSTREAM = "Downstream (+ suffix)";

  const items = [
    { label: FULL_REFRESH, description: "Append --full-refresh" },
    { label: UPSTREAM, description: "Include upstream models (prepend +)" },
    { label: DOWNSTREAM, description: "Include downstream models (append +)" },
  ];

  const selected = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    title: "dbt Model Options",
    placeHolder:
      "Select options (press Enter with none selected to run with defaults)",
  });

  // User cancelled (pressed Escape)
  if (selected === undefined) {
    return undefined;
  }

  const labels = new Set(selected.map((item: { label: string }) => item.label));

  return {
    fullRefresh: labels.has(FULL_REFRESH),
    upstream: labels.has(UPSTREAM),
    downstream: labels.has(DOWNSTREAM),
  };
}
