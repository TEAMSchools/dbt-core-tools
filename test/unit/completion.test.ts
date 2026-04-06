/**
 * Unit tests for DbtCompletionProvider.
 *
 * These tests verify the built-in function list is correctly defined
 * without requiring the vscode runtime.
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
    CompletionItem: class {
      label: string;
      kind: number;
      detail?: string;
      sortText?: string;
      constructor(label: string, kind: number) {
        this.label = label;
        this.kind = kind;
      }
    },
    CompletionItemKind: {
      Function: 1,
      Reference: 17,
      Field: 4,
      Module: 8,
      Property: 9,
      Keyword: 13,
    },
  },
} as any;

import * as assert from "assert";
import { DBT_BUILT_IN_FUNCTIONS } from "../../src/features/completion";

describe("DBT_BUILT_IN_FUNCTIONS", () => {
  it("includes ref", () => {
    assert.ok(
      DBT_BUILT_IN_FUNCTIONS.some((f) => f.name === "ref"),
      "Expected ref in built-in functions",
    );
  });

  it("includes source", () => {
    assert.ok(
      DBT_BUILT_IN_FUNCTIONS.some((f) => f.name === "source"),
      "Expected source in built-in functions",
    );
  });

  it("includes var", () => {
    assert.ok(
      DBT_BUILT_IN_FUNCTIONS.some((f) => f.name === "var"),
      "Expected var in built-in functions",
    );
  });

  it("includes is_incremental", () => {
    assert.ok(
      DBT_BUILT_IN_FUNCTIONS.some((f) => f.name === "is_incremental"),
      "Expected is_incremental in built-in functions",
    );
  });

  it("each entry has name and detail fields", () => {
    for (const fn of DBT_BUILT_IN_FUNCTIONS) {
      assert.ok(fn.name, "Expected name to be truthy");
      assert.ok(fn.detail, "Expected detail to be truthy");
    }
  });
});
