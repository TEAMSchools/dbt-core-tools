/**
 * Unit tests for DbtProject source lookup.
 */

import * as assert from "assert";
import { DbtProject } from "../../src/core/project";

describe("DbtProject.findSourceByFilePath", () => {
  it("returns a source when the file path matches", () => {
    const project = new DbtProject("/tmp/test/dbt_project.yml", {
      name: "test",
    });

    // Inject a manifest via type assertion for testing.
    const internal = project as unknown as {
      manifest: {
        nodes: Record<string, unknown>;
        sources: Record<string, unknown>;
        macros: Record<string, unknown>;
      };
    };
    internal.manifest = {
      nodes: {},
      sources: {
        "source.test.my_source.my_table": {
          unique_id: "source.test.my_source.my_table",
          resource_type: "source",
          source_name: "my_source",
          name: "my_table",
          identifier: "my_table",
          path: "models/staging/_sources.yml",
          original_file_path: "models/staging/_sources.yml",
          columns: {},
        },
      },
      macros: {},
    };

    const result = project.findSourceByFilePath(
      "/tmp/test/models/staging/_sources.yml",
    );
    assert.ok(result, "Expected a source to be found");
    assert.strictEqual(result!.unique_id, "source.test.my_source.my_table");
  });

  it("returns null when no source matches", () => {
    const project = new DbtProject("/tmp/test/dbt_project.yml", {
      name: "test",
    });
    const internal = project as unknown as {
      manifest: {
        nodes: Record<string, unknown>;
        sources: Record<string, unknown>;
        macros: Record<string, unknown>;
      };
    };
    internal.manifest = { nodes: {}, sources: {}, macros: {} };

    const result = project.findSourceByFilePath("/tmp/test/models/foo.yml");
    assert.strictEqual(result, null);
  });
});
