/**
 * Unit tests for parseProfileTargets.
 */

import * as assert from "assert";
import * as path from "path";
import { parseProfileTargets } from "../../src/core/profiles";

const FIXTURE_PATH = path.join(__dirname, "..", "fixtures", "profiles.yml");

describe("parseProfileTargets", () => {
  it("extracts targets and default target for a known profile", () => {
    const result = parseProfileTargets(FIXTURE_PATH, "kipptaf");
    assert.deepStrictEqual(result.targets, ["defer", "dev", "prod"]);
    assert.strictEqual(result.defaultTarget, "defer");
  });

  it("returns empty targets and null defaultTarget for a missing profile name", () => {
    const result = parseProfileTargets(FIXTURE_PATH, "nonexistent_profile");
    assert.deepStrictEqual(result.targets, []);
    assert.strictEqual(result.defaultTarget, null);
  });

  it("returns empty targets and null defaultTarget for a missing file path", () => {
    const result = parseProfileTargets(
      "/nonexistent/path/profiles.yml",
      "kipptaf",
    );
    assert.deepStrictEqual(result.targets, []);
    assert.strictEqual(result.defaultTarget, null);
  });
});
