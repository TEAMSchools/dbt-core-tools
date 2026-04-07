/**
 * Unit tests for in-memory target storage functions.
 *
 * targetSelector.ts statically imports `vscode`, so we register a minimal stub
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
    window: {
      createStatusBarItem: () => ({
        show: () => {},
        hide: () => {},
        dispose: () => {},
      }),
    },
    StatusBarAlignment: { Left: 1, Right: 2 },
  },
} as any;

import * as assert from "assert";
import {
  getSelectedTarget,
  setSelectedTarget,
} from "../../src/statusbar/targetSelector";

describe("in-memory target storage", () => {
  // Reset state between tests by clearing any set targets.
  afterEach(() => {
    setSelectedTarget("projectA", undefined);
    setSelectedTarget("projectB", undefined);
  });

  it("returns undefined when no target is set", () => {
    assert.strictEqual(getSelectedTarget("projectA"), undefined);
  });

  it("stores and retrieves a target", () => {
    setSelectedTarget("projectA", "dev");
    assert.strictEqual(getSelectedTarget("projectA"), "dev");
  });

  it("isolates targets by project name", () => {
    setSelectedTarget("projectA", "dev");
    setSelectedTarget("projectB", "prod");
    assert.strictEqual(getSelectedTarget("projectA"), "dev");
    assert.strictEqual(getSelectedTarget("projectB"), "prod");
  });

  it("clears a target when set to undefined", () => {
    setSelectedTarget("projectA", "dev");
    setSelectedTarget("projectA", undefined);
    assert.strictEqual(getSelectedTarget("projectA"), undefined);
  });
});
