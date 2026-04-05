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
// Terminal executor (one terminal per project — command queuing)
// ---------------------------------------------------------------------------

/** Map from projectName → active terminal. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _runningTerminals = new Map<string, any>();

/** Map from projectName → queued commands waiting to execute. */
const _commandQueues = new Map<string, string[]>();

/** Map from projectName → whether a command is currently running. */
const _commandRunning = new Map<string, boolean>();

/**
 * Executes a command in a dedicated VS Code terminal for the given project.
 * If a command is already running, queues it for execution after completion.
 * Reuses the same terminal per project.
 */
export function executeInTerminal(command: string, projectName: string): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const vscode = require("vscode") as VsCode;

  // Check if a terminal exists and is still open
  const existing = _runningTerminals.get(projectName);
  if (existing) {
    const allTerminals: readonly unknown[] = vscode.window.terminals;
    if (!allTerminals.includes(existing)) {
      _runningTerminals.delete(projectName);
      _commandRunning.delete(projectName);
      _commandQueues.delete(projectName);
    }
  }

  const terminal = _runningTerminals.get(projectName);

  if (terminal && _commandRunning.get(projectName)) {
    // Queue the command for later execution
    const queue = _commandQueues.get(projectName) ?? [];
    queue.push(command);
    _commandQueues.set(projectName, queue);
    return;
  }

  if (terminal) {
    // Terminal exists but no command running — send directly
    _commandRunning.set(projectName, true);
    terminal.show(true);
    terminal.sendText(command);
    return;
  }

  // Create a new terminal
  const newTerminal = vscode.window.createTerminal({
    name: `dbt: ${projectName}`,
    cwd: undefined,
  });
  _runningTerminals.set(projectName, newTerminal);
  _commandRunning.set(projectName, true);

  // Listen for command completion via shell integration
  const execDisposable = vscode.window.onDidEndTerminalShellExecution?.(
    (event: { terminal: unknown }) => {
      if (event.terminal !== _runningTerminals.get(projectName)) {
        return;
      }
      _commandRunning.set(projectName, false);

      const queue = _commandQueues.get(projectName);
      if (queue && queue.length > 0) {
        const next = queue.shift()!;
        _commandRunning.set(projectName, true);
        const t = _runningTerminals.get(projectName);
        if (t) {
          t.show(true);
          t.sendText(next);
        }
      }
    },
  );

  // Clean up when the terminal is closed
  const closeDisposable = vscode.window.onDidCloseTerminal(
    (closed: unknown) => {
      if (closed === newTerminal) {
        _runningTerminals.delete(projectName);
        _commandRunning.delete(projectName);
        _commandQueues.delete(projectName);
        closeDisposable.dispose();
        execDisposable?.dispose();
      }
    },
  );

  newTerminal.show(true);
  newTerminal.sendText(command);
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

    execFile(executable, args, { cwd }, (error, stdout, stderr) => {
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
    });
  });
}
