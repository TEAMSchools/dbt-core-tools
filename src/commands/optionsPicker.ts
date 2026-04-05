/**
 * Options picker for dbt model commands.
 *
 * Provides:
 * - buildSelector  — pure function that builds a dbt model selector string
 * - showOptionsPicker — vscode two-step quick pick for run/build/test
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
 * Shows a two-step quick pick:
 * Step 1: plain run vs run with options
 * Step 2 (only if "with options" chosen): multi-select for scope and flags
 *
 * Returns the selected options, empty {} for plain run, or undefined if cancelled.
 */
export async function showOptionsPicker(
  subcommand: string,
): Promise<PickerOptions | undefined> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const vscode = require("vscode") as VsCode;

  const label = subcommand.charAt(0).toUpperCase() + subcommand.slice(1);

  // Step 1: plain vs with-options
  const choice = await vscode.window.showQuickPick(
    [
      { label, description: `${label} with no additional options` },
      {
        label: `${label} with options...`,
        description: "Choose scope and flags",
      },
    ],
    { title: `dbt ${label}`, placeHolder: `How would you like to ${subcommand}?` },
  );

  if (!choice) {
    return undefined;
  }

  if (choice.label === label) {
    return {};
  }

  // Step 2: multi-select options
  const UPSTREAM = "Upstream (+ prefix)";
  const DOWNSTREAM = "Downstream (+ suffix)";
  const FULL_REFRESH = "Full Refresh";

  const items = [
    { label: UPSTREAM, description: "Include upstream models (prepend +)" },
    { label: DOWNSTREAM, description: "Include downstream models (append +)" },
  ];

  if (subcommand !== "test") {
    items.push({
      label: FULL_REFRESH,
      description: "Append --full-refresh",
    });
  }

  const selected = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    title: `dbt ${label} Options`,
    placeHolder: "Select options (press Enter with none selected for defaults)",
  });

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
