import { strict as assert } from "node:assert";
import {
  layoutGraph,
  NODE_WIDTH,
  NODE_HEIGHT,
} from "../../src/features/lineage/webview/layout";

function makeNode(id: string): any {
  return {
    id,
    type: "dbtNode",
    position: { x: 0, y: 0 },
    data: { id },
  };
}

function makeEdge(source: string, target: string): any {
  return { id: `e-${source}-${target}`, source, target };
}

describe("dagre layout engine", () => {
  it("positions a single node", () => {
    const result = layoutGraph([makeNode("a")], []);
    assert.equal(result.nodes.length, 1);
    assert.equal(typeof result.nodes[0].position.x, "number");
    assert.equal(typeof result.nodes[0].position.y, "number");
  });

  it("places downstream node to the right of upstream", () => {
    const nodes = [makeNode("a"), makeNode("b")];
    const edges = [makeEdge("a", "b")];
    const result = layoutGraph(nodes, edges);
    const a = result.nodes.find((n: any) => n.id === "a")!;
    const b = result.nodes.find((n: any) => n.id === "b")!;
    assert.ok(
      b.position.x > a.position.x,
      `b.x=${b.position.x} should be > a.x=${a.position.x}`,
    );
  });

  it("stacks siblings without overlap", () => {
    const nodes = [makeNode("a"), makeNode("b"), makeNode("c")];
    const edges = [makeEdge("a", "b"), makeEdge("a", "c")];
    const result = layoutGraph(nodes, edges);
    const b = result.nodes.find((n: any) => n.id === "b")!;
    const c = result.nodes.find((n: any) => n.id === "c")!;
    const dx = Math.abs(b.position.x - c.position.x);
    const dy = Math.abs(b.position.y - c.position.y);
    const overlaps = dx < NODE_WIDTH && dy < NODE_HEIGHT;
    assert.ok(!overlaps, `siblings should not overlap: dx=${dx} dy=${dy}`);
  });

  it("orders a linear chain left to right", () => {
    const nodes = [makeNode("a"), makeNode("b"), makeNode("c")];
    const edges = [makeEdge("a", "b"), makeEdge("b", "c")];
    const result = layoutGraph(nodes, edges);
    const a = result.nodes.find((n: any) => n.id === "a")!;
    const b = result.nodes.find((n: any) => n.id === "b")!;
    const c = result.nodes.find((n: any) => n.id === "c")!;
    assert.ok(a.position.x < b.position.x);
    assert.ok(b.position.x < c.position.x);
  });

  it("handles diamond dependencies without overlap", () => {
    const nodes = [makeNode("a"), makeNode("b"), makeNode("c"), makeNode("d")];
    const edges = [
      makeEdge("a", "b"),
      makeEdge("a", "c"),
      makeEdge("b", "d"),
      makeEdge("c", "d"),
    ];
    const result = layoutGraph(nodes, edges);
    const positions = result.nodes.map((n: any) => n.position);
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const dx = Math.abs(positions[i].x - positions[j].x);
        const dy = Math.abs(positions[i].y - positions[j].y);
        const overlaps = dx < NODE_WIDTH && dy < NODE_HEIGHT;
        assert.ok(
          !overlaps,
          `nodes ${result.nodes[i].id} and ${result.nodes[j].id} overlap`,
        );
      }
    }
  });

  it("handles fan-out", () => {
    const children = Array.from({ length: 5 }, (_, i) => makeNode(`c${i}`));
    const nodes = [makeNode("p"), ...children];
    const edges = children.map((c: any) => makeEdge("p", c.id));
    const result = layoutGraph(nodes, edges);
    const pX = result.nodes.find((n: any) => n.id === "p")!.position.x;
    const childNodes = result.nodes.filter((n: any) => n.id !== "p");
    for (const child of childNodes) {
      assert.ok(child.position.x > pX, `${child.id} should be right of parent`);
    }
    // With two-column layout, children may share y but must not overlap
    for (let i = 0; i < childNodes.length; i++) {
      for (let j = i + 1; j < childNodes.length; j++) {
        const dx = Math.abs(
          childNodes[i].position.x - childNodes[j].position.x,
        );
        const dy = Math.abs(
          childNodes[i].position.y - childNodes[j].position.y,
        );
        const overlaps = dx < NODE_WIDTH && dy < NODE_HEIGHT;
        assert.ok(
          !overlaps,
          `${childNodes[i].id} and ${childNodes[j].id} overlap`,
        );
      }
    }
  });

  it("returns edges unchanged", () => {
    const edges = [makeEdge("a", "b")];
    const result = layoutGraph([makeNode("a"), makeNode("b")], edges);
    assert.deepEqual(result.edges, edges);
  });

  it("returns empty for empty input", () => {
    const result = layoutGraph([], []);
    assert.equal(result.nodes.length, 0);
  });
});
