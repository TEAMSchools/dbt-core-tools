/**
 * Unit tests for buildGraphData in lineagePanel.ts.
 *
 * lineagePanel.ts statically imports `vscode` and `../../extension`, so we
 * register minimal stubs in the require cache before importing the module.
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
    Uri: {
      file: (f: string) => ({ fsPath: f }),
      joinPath: (...args: any[]) => ({ fsPath: args.join("/"), toString: () => args.join("/") }),
    },
    commands: {},
    ViewColumn: { One: 1 },
  },
} as any;

// Stub `../../extension` so lineagePanel.ts can be imported without the full
// extension activation chain.
const extensionStubPath = require("path").resolve(
  __dirname,
  "../../src/extension",
);
require.cache[extensionStubPath] = {
  id: extensionStubPath,
  filename: extensionStubPath,
  loaded: true,
  exports: {
    getActiveProject: () => null,
    getDiscovery: () => null,
    getDeferToggle: () => null,
    getOutputChannel: () => ({ appendLine: () => {} }),
    getManifestStatus: () => null,
  },
} as any;

import * as assert from "assert";
import { buildGraphData, GraphData, GraphNode, GraphEdge } from "../../src/features/lineage/lineagePanel";

// ---------------------------------------------------------------------------
// Mock project helper
// ---------------------------------------------------------------------------

function makeMockProject(opts: {
  nodes: Record<string, any>;
  sources?: Record<string, any>;
  parentMap?: Record<string, string[]>;
  childMap?: Record<string, string[]>;
}): any {
  return {
    getNodes: () => opts.nodes,
    getSources: () => opts.sources ?? {},
    getParentMap: () => opts.parentMap ?? {},
    getChildMap: () => opts.childMap ?? {},
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nodeIds(data: GraphData): string[] {
  return data.nodes.map((n) => n.id).sort();
}

function edgeKeys(data: GraphData): string[] {
  return data.edges.map((e) => `${e.source}->${e.target}`).sort();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildGraphData", () => {
  // -------------------------------------------------------------------------
  // 1. depth 0: center node only, no edges
  // -------------------------------------------------------------------------
  it("depth 0: returns only the center node and no edges", () => {
    const project = makeMockProject({
      nodes: {
        "model.proj.A": { unique_id: "model.proj.A", name: "A", resource_type: "model", config: {}, contract: {} },
        "model.proj.B": { unique_id: "model.proj.B", name: "B", resource_type: "model", config: {}, contract: {} },
      },
      parentMap: {
        "model.proj.A": ["model.proj.B"],
      },
      childMap: {
        "model.proj.B": ["model.proj.A"],
      },
    });

    const result = buildGraphData(project, "model.proj.A", "nn", 0);

    assert.deepStrictEqual(nodeIds(result), ["model.proj.A"]);
    assert.deepStrictEqual(result.edges, []);
  });

  // -------------------------------------------------------------------------
  // 2. nn mode, depth 1: traverses both upstream and downstream
  // -------------------------------------------------------------------------
  it("nn mode, depth 1: includes upstream and downstream neighbors", () => {
    const project = makeMockProject({
      nodes: {
        "model.proj.center": { unique_id: "model.proj.center", name: "center", resource_type: "model", config: {}, contract: {} },
        "model.proj.parent": { unique_id: "model.proj.parent", name: "parent", resource_type: "model", config: {}, contract: {} },
        "model.proj.child":  { unique_id: "model.proj.child",  name: "child",  resource_type: "model", config: {}, contract: {} },
      },
      parentMap: {
        "model.proj.center": ["model.proj.parent"],
      },
      childMap: {
        "model.proj.center": ["model.proj.child"],
      },
    });

    const result = buildGraphData(project, "model.proj.center", "nn", 1);

    assert.deepStrictEqual(
      nodeIds(result),
      ["model.proj.center", "model.proj.child", "model.proj.parent"].sort(),
    );
    assert.ok(
      result.edges.some((e) => e.source === "model.proj.parent" && e.target === "model.proj.center"),
      "expected parent→center edge",
    );
    assert.ok(
      result.edges.some((e) => e.source === "model.proj.center" && e.target === "model.proj.child"),
      "expected center→child edge",
    );
  });

  // -------------------------------------------------------------------------
  // 3. upstream mode: only traverses upstream, not downstream
  // -------------------------------------------------------------------------
  it("upstream mode: includes only upstream nodes, not downstream", () => {
    const project = makeMockProject({
      nodes: {
        "model.proj.center": { unique_id: "model.proj.center", name: "center", resource_type: "model", config: {}, contract: {} },
        "model.proj.parent": { unique_id: "model.proj.parent", name: "parent", resource_type: "model", config: {}, contract: {} },
        "model.proj.child":  { unique_id: "model.proj.child",  name: "child",  resource_type: "model", config: {}, contract: {} },
      },
      parentMap: {
        "model.proj.center": ["model.proj.parent"],
      },
      childMap: {
        "model.proj.center": ["model.proj.child"],
      },
    });

    const result = buildGraphData(project, "model.proj.center", "upstream", 1);

    assert.ok(
      result.nodes.some((n) => n.id === "model.proj.parent"),
      "expected parent in upstream result",
    );
    assert.ok(
      !result.nodes.some((n) => n.id === "model.proj.child"),
      "expected child NOT in upstream result",
    );
    assert.ok(
      result.edges.some((e) => e.source === "model.proj.parent" && e.target === "model.proj.center"),
      "expected parent→center edge",
    );
    assert.ok(
      !result.edges.some((e) => e.source === "model.proj.center"),
      "expected no downstream edges",
    );
  });

  // -------------------------------------------------------------------------
  // 4. downstream mode: only traverses downstream, not upstream
  // -------------------------------------------------------------------------
  it("downstream mode: includes only downstream nodes, not upstream", () => {
    const project = makeMockProject({
      nodes: {
        "model.proj.center": { unique_id: "model.proj.center", name: "center", resource_type: "model", config: {}, contract: {} },
        "model.proj.parent": { unique_id: "model.proj.parent", name: "parent", resource_type: "model", config: {}, contract: {} },
        "model.proj.child":  { unique_id: "model.proj.child",  name: "child",  resource_type: "model", config: {}, contract: {} },
      },
      parentMap: {
        "model.proj.center": ["model.proj.parent"],
      },
      childMap: {
        "model.proj.center": ["model.proj.child"],
      },
    });

    const result = buildGraphData(project, "model.proj.center", "downstream", 1);

    assert.ok(
      result.nodes.some((n) => n.id === "model.proj.child"),
      "expected child in downstream result",
    );
    assert.ok(
      !result.nodes.some((n) => n.id === "model.proj.parent"),
      "expected parent NOT in downstream result",
    );
    assert.ok(
      result.edges.some((e) => e.source === "model.proj.center" && e.target === "model.proj.child"),
      "expected center→child edge",
    );
    assert.ok(
      !result.edges.some((e) => e.target === "model.proj.center"),
      "expected no upstream edges",
    );
  });

  // -------------------------------------------------------------------------
  // 5. depth limit: depth 1 gets 1 level, depth 2 gets 2 levels
  // -------------------------------------------------------------------------
  it("depth 1: gets only one level of upstream", () => {
    const project = makeMockProject({
      nodes: {
        "model.proj.C": { unique_id: "model.proj.C", name: "C", resource_type: "model", config: {}, contract: {} },
        "model.proj.B": { unique_id: "model.proj.B", name: "B", resource_type: "model", config: {}, contract: {} },
        "model.proj.A": { unique_id: "model.proj.A", name: "A", resource_type: "model", config: {}, contract: {} },
      },
      parentMap: {
        "model.proj.C": ["model.proj.B"],
        "model.proj.B": ["model.proj.A"],
      },
      childMap: {},
    });

    const result = buildGraphData(project, "model.proj.C", "upstream", 1);

    assert.ok(result.nodes.some((n) => n.id === "model.proj.B"), "depth-1 includes B");
    assert.ok(!result.nodes.some((n) => n.id === "model.proj.A"), "depth-1 excludes A");
  });

  it("depth 2: gets two levels of upstream", () => {
    const project = makeMockProject({
      nodes: {
        "model.proj.C": { unique_id: "model.proj.C", name: "C", resource_type: "model", config: {}, contract: {} },
        "model.proj.B": { unique_id: "model.proj.B", name: "B", resource_type: "model", config: {}, contract: {} },
        "model.proj.A": { unique_id: "model.proj.A", name: "A", resource_type: "model", config: {}, contract: {} },
      },
      parentMap: {
        "model.proj.C": ["model.proj.B"],
        "model.proj.B": ["model.proj.A"],
      },
      childMap: {},
    });

    const result = buildGraphData(project, "model.proj.C", "upstream", 2);

    assert.ok(result.nodes.some((n) => n.id === "model.proj.B"), "depth-2 includes B");
    assert.ok(result.nodes.some((n) => n.id === "model.proj.A"), "depth-2 includes A");
  });

  // -------------------------------------------------------------------------
  // 6. test exclusion: test nodes are excluded from graph nodes but counted
  // -------------------------------------------------------------------------
  it("test nodes are excluded from graph nodes but counted in testCount", () => {
    const project = makeMockProject({
      nodes: {
        "model.proj.M": { unique_id: "model.proj.M", name: "M", resource_type: "model", config: {}, contract: {} },
      },
      parentMap: {},
      childMap: {
        "model.proj.M": ["test.proj.test_M_not_null", "test.proj.test_M_unique"],
      },
    });

    const result = buildGraphData(project, "model.proj.M", "nn", 1);

    // No test nodes should appear as graph nodes
    assert.ok(
      !result.nodes.some((n) => n.id.startsWith("test.")),
      "test nodes should not appear in graph nodes",
    );

    // The center node should have testCount = 2
    const centerNode = result.nodes.find((n) => n.id === "model.proj.M");
    assert.ok(centerNode, "center node should be present");
    assert.strictEqual(centerNode!.testCount, 2, "testCount should reflect number of test children");

    // No edges to test nodes
    assert.ok(
      !result.edges.some((e) => e.target.startsWith("test.")),
      "edges to test nodes should not appear",
    );
  });

  // -------------------------------------------------------------------------
  // 7. source supplementation: source→model edge appears even without childMap entry
  // -------------------------------------------------------------------------
  it("source supplementation: source→model edge is derived from parentMap when absent from childMap", () => {
    const project = makeMockProject({
      nodes: {
        "model.proj.M": { unique_id: "model.proj.M", name: "M", resource_type: "model", config: {}, contract: {} },
      },
      sources: {
        "source.proj.raw.S": { unique_id: "source.proj.raw.S", name: "S", resource_type: "source", original_file_path: "models/schema.yml" },
      },
      parentMap: {
        "model.proj.M": ["source.proj.raw.S"],
      },
      // Intentionally no childMap entry for source.proj.raw.S
      childMap: {},
    });

    const result = buildGraphData(project, "model.proj.M", "upstream", 1);

    // Source node should appear
    assert.ok(
      result.nodes.some((n) => n.id === "source.proj.raw.S"),
      "source node should be in graph",
    );

    // Edge from source to model should exist
    assert.ok(
      result.edges.some((e) => e.source === "source.proj.raw.S" && e.target === "model.proj.M"),
      "source→model edge should be present",
    );
  });

  it("source supplementation: downstream traversal from source works via supplemented childMap", () => {
    const project = makeMockProject({
      nodes: {
        "model.proj.M": { unique_id: "model.proj.M", name: "M", resource_type: "model", config: {}, contract: {} },
      },
      sources: {
        "source.proj.raw.S": { unique_id: "source.proj.raw.S", name: "S", resource_type: "source", original_file_path: "models/schema.yml" },
      },
      parentMap: {
        "model.proj.M": ["source.proj.raw.S"],
      },
      childMap: {},
    });

    // Starting from the source, downstream should reach model.proj.M
    const result = buildGraphData(project, "source.proj.raw.S", "downstream", 1);

    assert.ok(
      result.nodes.some((n) => n.id === "model.proj.M"),
      "downstream from source should include child model",
    );
    assert.ok(
      result.edges.some((e) => e.source === "source.proj.raw.S" && e.target === "model.proj.M"),
      "source→model edge should be present in downstream traversal",
    );
  });
});
