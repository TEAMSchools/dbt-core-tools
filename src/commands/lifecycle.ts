/**
 * Lifecycle commands for dbt Core Tools.
 *
 * Provides commands that map to dbt lifecycle CLI subcommands:
 * setup (deps + parse), deps, parse, clean, debug, retry.
 */

import * as vscode from "vscode";
import { buildDbtCommand, executeInTerminal } from "../core/executor";
import { getActiveProject, getDiscovery } from "../extension";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSettings(): { dbtCommand: string; profilesDir: string } {
  const config = vscode.workspace.getConfiguration("dbtCoreTools");
  const dbtCommand = config.get<string>("dbtCommand", "dbt");
  const profilesDir = config.get<string>("profilesDir", "");
  return { dbtCommand, profilesDir };
}

// ---------------------------------------------------------------------------
// Exported command handlers
// ---------------------------------------------------------------------------

/**
 * Runs `dbt deps && dbt parse` for the active dbt project.
 */
export function setupProject(): void {
  const project = getActiveProject();
  if (!project) {
    vscode.window.showWarningMessage(
      "dbt Core Tools: No active dbt project. Open a file inside a dbt project first.",
    );
    return;
  }

  const { dbtCommand, profilesDir } = getSettings();

  const depsCmd = buildDbtCommand({
    dbtCommand,
    subcommand: "deps",
    projectDir: project.rootPath,
    profilesDir: profilesDir || undefined,
  });

  const parseCmd = buildDbtCommand({
    dbtCommand,
    subcommand: "parse",
    projectDir: project.rootPath,
    profilesDir: profilesDir || undefined,
  });

  executeInTerminal(`${depsCmd} && ${parseCmd}`, project.name);
}

/**
 * Runs `dbt deps && dbt parse` for ALL discovered dbt projects sequentially
 * in a single terminal.
 */
export function setupAllProjects(): void {
  const discovery = getDiscovery();
  if (discovery.projects.length === 0) {
    vscode.window.showWarningMessage(
      "dbt Core Tools: No dbt projects found in the workspace.",
    );
    return;
  }

  const { dbtCommand, profilesDir } = getSettings();

  const commands: string[] = [];
  for (const project of discovery.projects) {
    const depsCmd = buildDbtCommand({
      dbtCommand,
      subcommand: "deps",
      projectDir: project.rootPath,
      profilesDir: profilesDir || undefined,
    });

    const parseCmd = buildDbtCommand({
      dbtCommand,
      subcommand: "parse",
      projectDir: project.rootPath,
      profilesDir: profilesDir || undefined,
    });

    commands.push(`${depsCmd} && ${parseCmd}`);
  }

  executeInTerminal(commands.join(" && "), "all projects");
}

/**
 * Runs `dbt deps` for the active dbt project.
 */
export function installDeps(): void {
  const project = getActiveProject();
  if (!project) {
    vscode.window.showWarningMessage(
      "dbt Core Tools: No active dbt project. Open a file inside a dbt project first.",
    );
    return;
  }

  const { dbtCommand, profilesDir } = getSettings();

  const cmd = buildDbtCommand({
    dbtCommand,
    subcommand: "deps",
    projectDir: project.rootPath,
    profilesDir: profilesDir || undefined,
  });

  executeInTerminal(cmd, project.name);
}

/**
 * Runs `dbt parse` for the active dbt project.
 */
export function parseProject(): void {
  const project = getActiveProject();
  if (!project) {
    vscode.window.showWarningMessage(
      "dbt Core Tools: No active dbt project. Open a file inside a dbt project first.",
    );
    return;
  }

  const { dbtCommand, profilesDir } = getSettings();

  const cmd = buildDbtCommand({
    dbtCommand,
    subcommand: "parse",
    projectDir: project.rootPath,
    profilesDir: profilesDir || undefined,
  });

  executeInTerminal(cmd, project.name);
}

/**
 * Runs `dbt clean` for the active dbt project.
 */
export function cleanProject(): void {
  const project = getActiveProject();
  if (!project) {
    vscode.window.showWarningMessage(
      "dbt Core Tools: No active dbt project. Open a file inside a dbt project first.",
    );
    return;
  }

  const { dbtCommand, profilesDir } = getSettings();

  const cmd = buildDbtCommand({
    dbtCommand,
    subcommand: "clean",
    projectDir: project.rootPath,
    profilesDir: profilesDir || undefined,
  });

  executeInTerminal(cmd, project.name);
}

/**
 * Runs `dbt debug` for the active dbt project.
 */
export function debugProject(): void {
  const project = getActiveProject();
  if (!project) {
    vscode.window.showWarningMessage(
      "dbt Core Tools: No active dbt project. Open a file inside a dbt project first.",
    );
    return;
  }

  const { dbtCommand, profilesDir } = getSettings();

  const cmd = buildDbtCommand({
    dbtCommand,
    subcommand: "debug",
    projectDir: project.rootPath,
    profilesDir: profilesDir || undefined,
  });

  executeInTerminal(cmd, project.name);
}

/**
 * Runs `dbt retry` for the active dbt project.
 */
export function retryProject(): void {
  const project = getActiveProject();
  if (!project) {
    vscode.window.showWarningMessage(
      "dbt Core Tools: No active dbt project. Open a file inside a dbt project first.",
    );
    return;
  }

  const { dbtCommand, profilesDir } = getSettings();

  const cmd = buildDbtCommand({
    dbtCommand,
    subcommand: "retry",
    projectDir: project.rootPath,
    profilesDir: profilesDir || undefined,
  });

  executeInTerminal(cmd, project.name);
}
