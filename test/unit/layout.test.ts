import { strict as assert } from "node:assert";
import {
  layoutGraph,
  resolveCollisions,
  NODE_WIDTH,
  NODE_HEIGHT,
} from "../../src/features/lineage/webview/layout";

function makeNode(id: string, depth = 0, x = 0, y = 0): any {
  return {
    id,
    type: "dbtNode",
    position: { x, y },
    data: { id, depth },
  };
}

function makeEdge(source: string, target: string): any {
  return { id: `e-${source}-${target}`, source, target };
}

describe("custom layout engine", () => {
  describe("layoutGraph", () => {
    it("positions a single node at origin", () => {
      const nodes = [makeNode("a", 0)];
      const result = layoutGraph(nodes, []);
      assert.equal(result.nodes.length, 1);
      assert.equal(result.nodes[0].position.x, 0);
      assert.equal(result.nodes[0].position.y, 0);
    });

    it("places downstream node to the right of upstream", () => {
      const nodes = [makeNode("a", 0), makeNode("b", 1)];
      const edges = [makeEdge("a", "b")];
      const result = layoutGraph(nodes, edges);
      const aNode = result.nodes.find((n: any) => n.id === "a")!;
      const bNode = result.nodes.find((n: any) => n.id === "b")!;
      assert.ok(
        bNode.position.x > aNode.position.x,
        "downstream node should be to the right",
      );
    });

    it("stacks sibling nodes vertically", () => {
      const nodes = [makeNode("a", 0), makeNode("b", 1), makeNode("c", 1)];
      const edges = [makeEdge("a", "b"), makeEdge("a", "c")];
      const result = layoutGraph(nodes, edges);
      const bNode = result.nodes.find((n: any) => n.id === "b")!;
      const cNode = result.nodes.find((n: any) => n.id === "c")!;
      assert.ok(
        bNode.position.y !== cNode.position.y,
        "siblings should have different y",
      );
    });

    it("handles upstream nodes with negative depth", () => {
      const nodes = [makeNode("a", -1), makeNode("b", 0), makeNode("c", 1)];
      const edges = [makeEdge("a", "b"), makeEdge("b", "c")];
      const result = layoutGraph(nodes, edges);
      const aNode = result.nodes.find((n: any) => n.id === "a")!;
      const bNode = result.nodes.find((n: any) => n.id === "b")!;
      const cNode = result.nodes.find((n: any) => n.id === "c")!;
      assert.ok(aNode.position.x < bNode.position.x);
      assert.ok(bNode.position.x < cNode.position.x);
    });
  });

  describe("resolveCollisions", () => {
    it("separates overlapping nodes at same x", () => {
      const nodes = [makeNode("a", 0, 0, 0), makeNode("b", 0, 0, 10)];
      const result = resolveCollisions(nodes);
      const aY = result.find((n: any) => n.id === "a")!.position.y;
      const bY = result.find((n: any) => n.id === "b")!.position.y;
      const gap = Math.abs(bY - aY);
      assert.ok(
        gap >= NODE_HEIGHT,
        `nodes should be at least ${NODE_HEIGHT}px apart, got ${gap}`,
      );
    });

    it("does not move non-overlapping nodes", () => {
      const nodes = [makeNode("a", 0, 0, 0), makeNode("b", 0, 0, 200)];
      const result = resolveCollisions(nodes);
      assert.equal(result.find((n: any) => n.id === "a")!.position.y, 0);
      assert.equal(result.find((n: any) => n.id === "b")!.position.y, 200);
    });
  });
});
