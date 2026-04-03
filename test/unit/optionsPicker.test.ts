/**
 * Unit tests for buildSelector (pure function — no vscode dependency).
 */

import * as assert from "assert";
import { buildSelector } from "../../src/commands/optionsPicker";

describe("buildSelector", () => {
  it("returns the model name unchanged when no options are set", () => {
    const result = buildSelector("my_model", {});
    assert.strictEqual(result, "my_model");
  });

  it("prepends + when upstream is true", () => {
    const result = buildSelector("my_model", { upstream: true });
    assert.strictEqual(result, "+my_model");
  });

  it("appends + when downstream is true", () => {
    const result = buildSelector("my_model", { downstream: true });
    assert.strictEqual(result, "my_model+");
  });

  it("prepends and appends + when both upstream and downstream are true", () => {
    const result = buildSelector("my_model", { upstream: true, downstream: true });
    assert.strictEqual(result, "+my_model+");
  });

  it("ignores fullRefresh (does not affect selector string)", () => {
    const result = buildSelector("my_model", { fullRefresh: true });
    assert.strictEqual(result, "my_model");
  });

  it("handles all options set together", () => {
    const result = buildSelector("my_model", { upstream: true, downstream: true, fullRefresh: true });
    assert.strictEqual(result, "+my_model+");
  });
});
