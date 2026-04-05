/**
 * Unit tests for formatRelativeTime (pure function — no vscode dependency).
 *
 * manifestStatus.ts statically imports `vscode`, so we register a minimal stub
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
    EventEmitter: class {},
    Uri: { file: (f: string) => ({ fsPath: f }) },
    StatusBarAlignment: { Left: 1, Right: 2 },
  },
} as any;

import * as assert from "assert";
import { formatRelativeTime } from "../../src/statusbar/manifestStatus";

describe("formatRelativeTime", () => {
  it("returns 'just now' for times less than 60 seconds ago", () => {
    const now = new Date();
    const thirtySecondsAgo = new Date(now.getTime() - 30_000);
    assert.strictEqual(formatRelativeTime(thirtySecondsAgo, now), "just now");
  });

  it("returns '1m ago' for times 60-119 seconds ago", () => {
    const now = new Date();
    const oneMinAgo = new Date(now.getTime() - 75_000);
    assert.strictEqual(formatRelativeTime(oneMinAgo, now), "1m ago");
  });

  it("returns '5m ago' for times ~5 minutes ago", () => {
    const now = new Date();
    const fiveMinAgo = new Date(now.getTime() - 5 * 60_000);
    assert.strictEqual(formatRelativeTime(fiveMinAgo, now), "5m ago");
  });

  it("returns '1h ago' for times ~1 hour ago", () => {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 65 * 60_000);
    assert.strictEqual(formatRelativeTime(oneHourAgo, now), "1h ago");
  });

  it("returns '2h ago' for times ~2 hours ago", () => {
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60_000);
    assert.strictEqual(formatRelativeTime(twoHoursAgo, now), "2h ago");
  });

  it("returns '1d ago' for times ~24 hours ago", () => {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 25 * 60 * 60_000);
    assert.strictEqual(formatRelativeTime(oneDayAgo, now), "1d ago");
  });

  it("returns '3d ago' for times ~3 days ago", () => {
    const now = new Date();
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60_000);
    assert.strictEqual(formatRelativeTime(threeDaysAgo, now), "3d ago");
  });
});
