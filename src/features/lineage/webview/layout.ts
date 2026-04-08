import dagre from "@dagrejs/dagre";
import type { Node, Edge } from "@xyflow/react";
import type { GraphNodeData } from "./types";

export const NODE_WIDTH = 160;
export const NODE_HEIGHT = 64;
const RANK_SEP = 60;
const NODE_SEP = 20;
const SIBLING_COL_GAP = 20;
const MAX_PER_COL = 6;

/**
 * Runs dagre layout, then rearranges sibling groups (7+ nodes sharing the
 * same parent) into N columns of up to 6, to conserve vertical space.
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

  // Build parent→children map from edges
  const childrenOf = new Map<string, string[]>();
  for (const edge of edges) {
    const list = childrenOf.get(edge.source);
    if (list) list.push(edge.target);
    else childrenOf.set(edge.source, [edge.target]);
  }

  const overrides = new Map<string, { x: number; y: number }>();

  for (const [parentId, children] of childrenOf) {
    if (children.length < 7) continue;

    const parentPos = g.node(parentId);
    if (!parentPos) continue;

    // Sort children by dagre y-position for stable ordering
    const sorted = [...children].sort((a, b) => {
      const pa = g.node(a);
      const pb = g.node(b);
      return (pa?.y ?? 0) - (pb?.y ?? 0);
    });

    // Split into N columns of up to MAX_PER_COL each
    const numCols = Math.ceil(sorted.length / MAX_PER_COL);
    const columns: string[][] = [];
    for (let c = 0; c < numCols; c++) {
      columns.push(sorted.slice(c * MAX_PER_COL, (c + 1) * MAX_PER_COL));
    }

    // Base x from dagre, center the column group around it
    const baseX = g.node(sorted[0])?.x ?? 0;
    const totalWidth = numCols * NODE_WIDTH + (numCols - 1) * SIBLING_COL_GAP;
    const groupStartX = baseX - totalWidth / 2 + NODE_WIDTH / 2;

    // Tallest column determines the vertical extent, plus stagger offset
    const maxRows = Math.max(...columns.map((col) => col.length));
    const staggerY = (NODE_HEIGHT + NODE_SEP) / 2;
    const groupHeight =
      maxRows * NODE_HEIGHT + (maxRows - 1) * NODE_SEP + staggerY;
    const groupStartY = parentPos.y - groupHeight / 2 + NODE_HEIGHT / 2;

    for (let c = 0; c < columns.length; c++) {
      const colX = groupStartX + c * (NODE_WIDTH + SIBLING_COL_GAP);
      const col = columns[c];
      const yOffset = c % 2 === 1 ? staggerY : 0;

      for (let r = 0; r < col.length; r++) {
        if (!overrides.has(col[r])) {
          overrides.set(col[r], {
            x: colX,
            y: groupStartY + r * (NODE_HEIGHT + NODE_SEP) + yOffset,
          });
        }
      }
    }
  }

  const positioned = nodes.map((node) => {
    const override = overrides.get(node.id);
    if (override) {
      return {
        ...node,
        position: {
          x: override.x - NODE_WIDTH / 2,
          y: override.y - NODE_HEIGHT / 2,
        },
      };
    }
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
