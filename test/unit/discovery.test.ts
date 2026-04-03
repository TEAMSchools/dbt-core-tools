/**
 * Unit tests for DbtProject and ProjectDiscovery pure-logic helpers.
 *
 * Tests are limited to code paths that do NOT require the vscode runtime:
 *  - DbtProject.containsFile
 *  - extractProjectName
 *  - findProjectForFile (standalone export from discovery)
 */

import * as assert from "assert";
import * as path from "path";
import { DbtProject, extractProjectName } from "../../src/core/project";
import { findProjectForFile } from "../../src/core/discovery";

// ---------------------------------------------------------------------------
// Helper — builds a DbtProject using a fake filesystem path
// ---------------------------------------------------------------------------
function makeProject(rootPath: string, name = "my_project"): DbtProject {
  const ymlPath = path.join(rootPath, "dbt_project.yml");
  return new DbtProject(ymlPath, { name });
}

// ---------------------------------------------------------------------------
// DbtProject.containsFile
// ---------------------------------------------------------------------------
describe("DbtProject.containsFile", () => {
  const root = "/workspace/analytics";
  let project: DbtProject;

  beforeEach(() => {
    project = makeProject(root);
  });

  it("returns true for a file directly inside the project root", () => {
    assert.strictEqual(project.containsFile(`${root}/models/orders.sql`), true);
  });

  it("returns true for a file nested several directories deep", () => {
    assert.strictEqual(
      project.containsFile(`${root}/models/staging/raw/stg_orders.sql`),
      true,
    );
  });

  it("returns true for a file in the target directory", () => {
    assert.strictEqual(
      project.containsFile(`${root}/target/manifest.json`),
      true,
    );
  });

  it("returns true for the dbt_project.yml file itself", () => {
    assert.strictEqual(project.containsFile(`${root}/dbt_project.yml`), true);
  });

  it("returns false for a sibling directory", () => {
    assert.strictEqual(
      project.containsFile("/workspace/other_project/models/orders.sql"),
      false,
    );
  });

  it("returns false for a completely unrelated path", () => {
    assert.strictEqual(
      project.containsFile("/home/user/.dbt/profiles.yml"),
      false,
    );
  });

  it("returns false for a path that starts with the root as a prefix but is not inside it", () => {
    // e.g., root is /workspace/analytics but path is /workspace/analytics_extra/...
    assert.strictEqual(
      project.containsFile("/workspace/analytics_extra/models/foo.sql"),
      false,
    );
  });

  it("returns false for the parent directory of the root", () => {
    assert.strictEqual(project.containsFile("/workspace"), false);
  });
});

// ---------------------------------------------------------------------------
// extractProjectName
// ---------------------------------------------------------------------------
describe("extractProjectName", () => {
  it("extracts an unquoted project name", () => {
    const yml = `name: jaffle_shop\nversion: '1.0'\n`;
    assert.strictEqual(extractProjectName(yml), "jaffle_shop");
  });

  it("extracts a single-quoted project name", () => {
    const yml = `name: 'my_project'\nversion: '1.0'\n`;
    assert.strictEqual(extractProjectName(yml), "my_project");
  });

  it("extracts a double-quoted project name", () => {
    const yml = `name: "analytics"\nversion: '1.0'\n`;
    assert.strictEqual(extractProjectName(yml), "analytics");
  });

  it("extracts name with underscores and numbers", () => {
    const yml = `name: project_2025_v2\n`;
    assert.strictEqual(extractProjectName(yml), "project_2025_v2");
  });

  it("returns null when name field is absent", () => {
    const yml = `version: '1.0'\nprofile: default\n`;
    assert.strictEqual(extractProjectName(yml), null);
  });

  it("handles extra whitespace after the colon", () => {
    const yml = `name:   spaced_project\n`;
    assert.strictEqual(extractProjectName(yml), "spaced_project");
  });

  it("ignores an indented name field (only matches top-level)", () => {
    // Indented name: fields (e.g. inside models:) should NOT match because
    // the regex anchors to start of line with ^
    const yml = `models:\n  name: nested_value\nname: top_level\n`;
    assert.strictEqual(extractProjectName(yml), "top_level");
  });
});

// ---------------------------------------------------------------------------
// findProjectForFile (pure helper from discovery.ts)
// ---------------------------------------------------------------------------
describe("findProjectForFile", () => {
  it("returns null when the list is empty", () => {
    assert.strictEqual(findProjectForFile([], "/any/path/file.sql"), null);
  });

  it("returns the matching project", () => {
    const p = makeProject("/workspace/analytics");
    const result = findProjectForFile(
      [p],
      "/workspace/analytics/models/foo.sql",
    );
    assert.strictEqual(result, p);
  });

  it("returns null when no project contains the file", () => {
    const p = makeProject("/workspace/analytics");
    const result = findProjectForFile([p], "/workspace/other/models/foo.sql");
    assert.strictEqual(result, null);
  });

  it("returns the most specific (longest root) project for nested projects", () => {
    const parent = makeProject("/workspace/analytics", "analytics");
    const child = makeProject(
      "/workspace/analytics/sub_project",
      "sub_project",
    );
    const filePath = "/workspace/analytics/sub_project/models/foo.sql";

    const result = findProjectForFile([parent, child], filePath);
    assert.strictEqual(result, child);
  });

  it("returns the most specific project regardless of array order", () => {
    const parent = makeProject("/workspace/analytics", "analytics");
    const child = makeProject(
      "/workspace/analytics/sub_project",
      "sub_project",
    );
    const filePath = "/workspace/analytics/sub_project/models/foo.sql";

    // Try with child first in the array
    const result = findProjectForFile([child, parent], filePath);
    assert.strictEqual(result, child);
  });

  it("returns the only matching project when there are multiple non-matching ones", () => {
    const p1 = makeProject("/workspace/project_a", "project_a");
    const p2 = makeProject("/workspace/project_b", "project_b");
    const p3 = makeProject("/workspace/project_c", "project_c");

    const result = findProjectForFile(
      [p1, p2, p3],
      "/workspace/project_b/models/bar.sql",
    );
    assert.strictEqual(result, p2);
  });
});
