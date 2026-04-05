# Task API executor migration

## Problem

`executeInTerminal` uses `vscode.window.onDidEndTerminalShellExecution` to detect when a command finishes so it can drain a queue. That API requires shell integration, which is not available in all terminal environments. When absent, `_commandRunning` is never reset, queued commands accumulate silently, and closing the terminal drops them all.

## Solution

Replace the terminal-reuse + shell-integration infrastructure with VS Code's Task API. Each `executeInTerminal` call creates a `vscode.Task` with `ShellExecution`. Completion is detected via `onDidEndTaskProcess`, which fires reliably regardless of shell integration.

## Design

### State

Two maps replace the current three (`_runningTerminals`, `_commandRunning`, `_commandQueues`):

```typescript
_commandQueues: Map<string, string[]>; // projectName -> pending commands
_taskRunning: Map<string, boolean>; // projectName -> whether a task is executing
```

### `executeInTerminal(command, projectName)`

1. Push `command` onto `_commandQueues[projectName]`.
2. Call `drainQueue(projectName)`.

### `drainQueue(projectName)`

1. If `_taskRunning[projectName]` is true, return.
2. Shift next command from queue. If empty, return.
3. Set `_taskRunning[projectName] = true`.
4. Create a `vscode.Task`:
   - Type: `"dbt"`
   - Name: `"dbt: ${projectName}"`
   - Source: `"dbt Core Tools"`
   - Execution: `new ShellExecution(command)`
   - `presentationOptions.reveal`: `TaskRevealKind.Always`
5. Call `vscode.tasks.executeTask(task)`.

### Completion listener

A single `vscode.tasks.onDidEndTaskProcess` listener registered once via `initExecutor(context)` during `activate()`. When it fires for a task with source `"dbt Core Tools"`:

1. Extract `projectName` from the task name (strip `"dbt: "` prefix).
2. Set `_taskRunning[projectName] = false`.
3. Call `drainQueue(projectName)`.

### `initExecutor(context: ExtensionContext)`

New exported function called from `activate()`. Registers the `onDidEndTaskProcess` listener and pushes the disposable to `context.subscriptions`.

### What stays the same

- `buildDbtCommand`, `splitCommand`, `executeAndCapture` -- untouched.
- `DbtCommandOptions`, `CaptureResult` interfaces -- untouched.
- All callers (`lifecycle.ts`, `modelCommands.ts`, `stageExternal.ts`) -- untouched.
- Lazy `require("vscode")` pattern -- preserved for unit test compatibility.

### What gets deleted

- `_runningTerminals` map.
- `_commandRunning` map (replaced by `_taskRunning`).
- Terminal existence check logic (lines 128-137).
- `onDidEndTerminalShellExecution` listener.
- `onDidCloseTerminal` listener.

## Files modified

- `src/core/executor.ts` -- replace `executeInTerminal` internals, add `initExecutor`.
- `src/extension.ts` -- call `initExecutor(context)` in `activate()`.
