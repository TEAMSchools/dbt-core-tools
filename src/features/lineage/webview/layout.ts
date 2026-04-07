import dagre from "@dagrejs/dagre";
import type { Node, Edge } from "@xyflow/react";
import type { GraphNodeData } from "./types";

export const NODE_WIDTH = 160;
export const NODE_HEIGHT = 64;
const RANK_SEP = 60;
const NODE_SEP = 20;

/**
 * Runs dagre layout on the full set of nodes and edges.
 * Returns nodes with dagre-computed positions; edges pass through unchanged.
 */
export function layoutGraph(
  nodes: Node<GraphNodeData>[],
  edges: Edge[],
): { nodes: Node<GraphNodeData>[]; edges: Edge[] } {
  if (nodes.length === 0) return { nodes, edges };

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", ranksep: RANK_SEP, nodesep: NODE_SEP });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  const positioned = nodes.map((node) => {
    const pos = g.node(node.id);
    return {
      ...node,
      position: {
        x: pos.x - NODE_WIDTH / 2,
        y: pos.y - NODE_HEIGHT / 2,
      },
    };
  });

  return { nodes: positioned, edges };
}
