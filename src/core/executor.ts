/**
 * Command executor for dbt Core CLI.
 *
 * Provides:
 * - buildDbtCommand  — pure function that constructs a dbt CLI command string
 * - executeInTerminal — runs a command in a VS Code terminal (one per project)
 * - executeAndCapture — runs a command via child_process.execFile and returns output
 */

// vscode is NOT imported at the top level so this module can be loaded
// in unit tests without the VS Code runtime present.
// The vscode API is accessed lazily via require() inside terminal functions.
import { execFile } from "child_process";
import * as path from "path";
import * as fs from "fs";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type VsCode = typeof import("vscode");

export interface DbtCommandOptions {
  /** Command prefix for invoking dbt (e.g. "dbt" or "uv run dbt"). */
  dbtCommand: string;
  /** dbt subcommand (e.g. "run", "build", "test", "parse"). */
  subcommand: string;
  /** Absolute path to the dbt project directory. */
  projectDir: string;
  /** Model selector passed via -s (optional for lifecycle commands). */
  selector?: string;
  /** --target value. */
  target?: string;
  /** --profiles-dir value. */
  profilesDir?: string;
  /** --state value; also implies --defer when set. */
  deferState?: string;
  /** Append --full-refresh when true. */
  fullRefresh?: boolean;
  /** --vars value (raw string). */
  vars?: string;
  /** Extra raw args appended at the end. */
  args?: string;
  /** --limit value (for dbt show). */
  limit?: number;
}

export interface CaptureResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// ---------------------------------------------------------------------------
// Venv executable resolver
// ---------------------------------------------------------------------------

/**
 * Resolves the dbt executable path. When dbtCommand is the default "dbt",
 * checks for a venv dbt executable in the project directory or VIRTUAL_ENV.
 * Returns the original dbtCommand for non-default values.
 */
export function resolveDbtExecutable(
  dbtCommand: string,
  projectDir: string,
): string {
  if (dbtCommand !== "dbt") {
    return dbtCommand;
  }

  const isWin = process.platform === "win32";
  const binName = isWin ? "dbt.exe" : "dbt";
  const binDir = isWin ? "Scripts" : "bin";

  // Check .venv in project directory.
  const venvPath = path.join(projectDir, ".venv", binDir, binName);
  if (fs.existsSync(venvPath)) {
    return venvPath;
  }

  // Check VIRTUAL_ENV environment variable.
  const virtualEnv = process.env["VIRTUAL_ENV"];
  if (virtualEnv) {
    const envPath = path.join(virtualEnv, binDir, binName);
    if (fs.existsSync(envPath)) {
      return envPath;
    }
  }

  return dbtCommand;
}

// ---------------------------------------------------------------------------
// Pure command builder
// ---------------------------------------------------------------------------

/**
 * Builds a dbt CLI command string from structured options.
 * The returned string is suitable for passing to a terminal or shell-splitting.
 */
export function buildDbtCommand(options: DbtCommandOptions): string {
  const parts: string[] = [];

  // Command prefix (e.g. "dbt" or "uv run dbt") + subcommand
  parts.push(options.dbtCommand);
  parts.push(options.subcommand);

  // Optional model selector
  if (options.selector) {
    parts.push(`-s ${options.selector}`);
  }

  // Required project dir
  parts.push(`--project-dir=${options.projectDir}`);

  // Optional flags
  if (options.target) {
    parts.push(`--target=${options.target}`);
  }

  if (options.profilesDir) {
    parts.push(`--profiles-dir=${options.profilesDir}`);
  }

  if (options.deferState) {
    parts.push("--defer");
    parts.push(`--state=${options.deferState}`);
  }

  if (options.fullRefresh) {
    parts.push("--full-refresh");
  }

  if (options.vars !== undefined && options.vars !== "") {
    parts.push(`--vars=${options.vars}`);
  }

  if (options.limit !== undefined) {
    parts.push(`--limit=${options.limit}`);
  }

  if (options.args) {
    parts.push(options.args);
  }

  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Task-based executor (one task per command, per-project queuing)
// ---------------------------------------------------------------------------

/** Map from projectName → queued commands waiting to execute. */
const _commandQueues = new Map<string, string[]>();

/** Map from projectName → whether a task is currently running. */
const _taskRunning = new Map<string, boolean>();

const TASK_SOURCE = "dbt Core Tools";
const TASK_NAME_PREFIX = "dbt: ";

/**
 * Registers the `onDidEndTaskProcess` listener that drains command queues.
 * Must be called once during `activate()`.
 */
export function initExecutor(context: {
  subscriptions: { dispose(): void }[];
}): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const vscode = require("vscode") as VsCode;

  const disposable = vscode.tasks.onDidEndTaskProcess((event) => {
    const task = event.execution.task;
    if (task.source !== TASK_SOURCE) {
      return;
    }
    const projectName = task.name.startsWith(TASK_NAME_PREFIX)
      ? task.name.slice(TASK_NAME_PREFIX.length)
      : task.name;
    _taskRunning.set(projectName, false);
    drainQueue(projectName);
  });

  context.subscriptions.push(disposable);
}

/**
 * Executes a command in a VS Code task terminal for the given project.
 * If a task is already running for the project, queues it for sequential execution.
 */
export function executeInTerminal(command: string, projectName: string): void {
  const queue = _commandQueues.get(projectName) ?? [];
  queue.push(command);
  _commandQueues.set(projectName, queue);
  drainQueue(projectName);
}

function drainQueue(projectName: string): void {
  if (_taskRunning.get(projectName)) {
    return;
  }

  const queue = _commandQueues.get(projectName);
  if (!queue || queue.length === 0) {
    return;
  }

  const command = queue.shift()!;
  _taskRunning.set(projectName, true);

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const vscode = require("vscode") as VsCode;

  const taskDef = { type: "dbt" };
  const task = new vscode.Task(
    taskDef,
    vscode.TaskScope.Workspace,
    `${TASK_NAME_PREFIX}${projectName}`,
    TASK_SOURCE,
    new vscode.ShellExecution(command, { env: process.env }),
  );
  task.presentationOptions = {
    reveal: vscode.TaskRevealKind.Always,
    panel: vscode.TaskPanelKind.Shared,
  };

  vscode.tasks.executeTask(task).then(undefined, (err: unknown) => {
    vscode.window.showWarningMessage(
      `dbt Core Tools: Failed to execute task for "${projectName}": ${err}`,
    );
    _taskRunning.set(projectName, false);
    drainQueue(projectName);
  });
}

// ---------------------------------------------------------------------------
// Programmatic capture via child_process.execFile
// ---------------------------------------------------------------------------

/**
 * Splits a command string on whitespace while respecting single and double
 * quoted segments. For example:
 *   splitCommand('uv run dbt run --vars={"k": "v"}')
 *   => ['uv', 'run', 'dbt', 'run', '--vars={"k":', '"v"}']
 *
 * This is intentionally simple — it handles the common cases produced by
 * buildDbtCommand without pulling in an external library.
 */
export function splitCommand(cmd: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i];

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      // Include the quote character in the token
      current += ch;
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      current += ch;
    } else if (ch === " " && !inSingle && !inDouble) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

/**
 * Runs `command` in the given `cwd` directory, capturing stdout/stderr.
 * Uses `child_process.execFile` with an explicit args array to avoid
 * shell injection vulnerabilities.
 *
 * @returns A promise that resolves with stdout, stderr, and the exit code.
 */
export function executeAndCapture(
  command: string,
  cwd: string,
): Promise<CaptureResult> {
  return new Promise((resolve) => {
    const [executable, ...args] = splitCommand(command);

    if (!executable) {
      resolve({ stdout: "", stderr: "Empty command", exitCode: 1 });
      return;
    }

    execFile(
      executable,
      args,
      { cwd, shell: true, env: process.env },
      (error, stdout, stderr) => {
        const exitCode =
          error?.code !== undefined
            ? typeof error.code === "number"
              ? error.code
              : 1
            : 0;

        resolve({
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          exitCode,
        });
      },
    );
  });
}
