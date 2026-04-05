/**
 * Unit tests for resolveWorkspacePath (pure function — no vscode dependency).
 *
 * modelCommands.ts statically imports `vscode`, so we register a minimal stub
 * in the require cache before importing the module under test.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

// Stub `vscode` and transitive extension imports before loading the module.
const Module = require("module");
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request: string, ...args: unknown[]) {
  if (request === "vscode") return "vscode";
  return originalResolveFilename.call(this, request, ...args);
};
require.cache["vscode"] = {
  id: "vscode",
  filename: "vscode",
  loaded: true,
  exports: {
    workspace: {
      getConfiguration: () => ({ get: () => undefined }),
      workspaceFolders: undefined,
    },
    window: {},
    EventEmitter: class {},
    Uri: { file: (f: string) => ({ fsPath: f }) },
  },
} as any;

import * as assert from "assert";
import { resolveWorkspacePath } from "../../src/commands/modelCommands";

describe("resolveWorkspacePath", () => {
  it("resolves a relative path against the workspace root", () => {
    const result = resolveWorkspacePath(".dbt", "/workspaces/teamster");
    assert.strictEqual(result, "/workspaces/teamster/.dbt");
  });

  it("returns an absolute path unchanged", () => {
    const result = resolveWorkspacePath(
      "/home/user/.dbt",
      "/workspaces/teamster",
    );
    assert.strictEqual(result, "/home/user/.dbt");
  });

  it("returns undefined when input is undefined", () => {
    const result = resolveWorkspacePath(undefined, "/workspaces/teamster");
    assert.strictEqual(result, undefined);
  });

  it("returns undefined when input is empty string", () => {
    const result = resolveWorkspacePath("", "/workspaces/teamster");
    assert.strictEqual(result, undefined);
  });

  it("resolves nested relative paths", () => {
    const result = resolveWorkspacePath(
      "config/.dbt",
      "/workspaces/teamster",
    );
    assert.strictEqual(result, "/workspaces/teamster/config/.dbt");
  });
});
