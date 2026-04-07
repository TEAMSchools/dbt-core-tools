import type { Node, Edge } from "@xyflow/react";
import type { GraphNodeData } from "./types";

export const NODE_WIDTH = 160;
export const NODE_HEIGHT = 64;
const RANK_GAP = 60;
const NODE_GAP = 20;
const COL_WIDTH = NODE_WIDTH + RANK_GAP;

/**
 * Assigns positions to nodes based on their `data.depth` property.
 * Nodes at the same depth are stacked vertically, centered around y=0.
 */
export function layoutGraph(
  nodes: Node<GraphNodeData>[],
  edges: Edge[],
): { nodes: Node<GraphNodeData>[]; edges: Edge[] } {
  if (nodes.length === 0) return { nodes, edges };

  const byDepth = new Map<number, Node<GraphNodeData>[]>();
  for (const node of nodes) {
    const depth = (node.data as GraphNodeData)?.depth ?? 0;
    if (!byDepth.has(depth)) byDepth.set(depth, []);
    byDepth.get(depth)!.push(node);
  }

  const minDepth = Math.min(...byDepth.keys());

  const positioned = nodes.map((node) => {
    const depth = (node.data as GraphNodeData)?.depth ?? 0;
    const col = byDepth.get(depth)!;
    const index = col.indexOf(node);
    const colHeight = col.length * NODE_HEIGHT + (col.length - 1) * NODE_GAP;
    const startY = Math.round(-colHeight / 2 + NODE_HEIGHT / 2);

    return {
      ...node,
      position: {
        x: (depth - minDepth) * COL_WIDTH,
        y: startY + index * (NODE_HEIGHT + NODE_GAP),
      },
    };
  });

  return { nodes: positioned, edges };
}

/**
 * Positions new nodes adjacent to an expanded parent node.
 * Existing nodes keep their positions; only new nodes are placed.
 */
export function layoutExpand(
  existingNodes: Node<GraphNodeData>[],
  newNodes: Node<GraphNodeData>[],
  parentId: string,
): Node<GraphNodeData>[] {
  if (newNodes.length === 0) return existingNodes;

  const parent = existingNodes.find((n) => n.id === parentId);
  if (!parent) {
    return [...existingNodes, ...newNodes];
  }

  const parentY = parent.position.y;
  const parentDepth = (parent.data as GraphNodeData)?.depth ?? 0;

  const totalHeight =
    newNodes.length * NODE_HEIGHT + (newNodes.length - 1) * NODE_GAP;
  const startY = parentY + NODE_HEIGHT / 2 - totalHeight / 2;

  const oldMinDepth = Math.min(
    ...existingNodes.map((n) => (n.data as GraphNodeData)?.depth ?? 0),
  );
  const newMinDepth = Math.min(
    oldMinDepth,
    ...newNodes.map((n) => (n.data as GraphNodeData)?.depth ?? parentDepth + 1),
  );

  const positioned = newNodes.map((node, i) => {
    const depth = (node.data as GraphNodeData)?.depth ?? parentDepth + 1;
    return {
      ...node,
      position: {
        x: (depth - newMinDepth) * COL_WIDTH,
        y: startY + i * (NODE_HEIGHT + NODE_GAP),
      },
    };
  });

  // If minDepth changed (upstream expansion), recompute x for existing nodes too.
  const reposExisting =
    newMinDepth !== oldMinDepth
      ? existingNodes.map((n) => {
          const depth = (n.data as GraphNodeData)?.depth ?? 0;
          return {
            ...n,
            position: { ...n.position, x: (depth - newMinDepth) * COL_WIDTH },
          };
        })
      : existingNodes;

  return resolveCollisions([...reposExisting, ...positioned]);
}

/**
 * Resolves vertical overlaps between nodes at the same x-column.
 */
export function resolveCollisions(
  nodes: Node<GraphNodeData>[],
): Node<GraphNodeData>[] {
  const byCol = new Map<number, Node<GraphNodeData>[]>();
  for (const node of nodes) {
    const col = Math.round(node.position.x / COL_WIDTH);
    if (!byCol.has(col)) byCol.set(col, []);
    byCol.get(col)!.push(node);
  }

  const result = [...nodes];

  for (const [, colNodes] of byCol) {
    if (colNodes.length < 2) continue;

    colNodes.sort((a, b) => a.position.y - b.position.y);

    for (let i = 1; i < colNodes.length; i++) {
      const prev = colNodes[i - 1];
      const curr = colNodes[i];
      const minY = prev.position.y + NODE_HEIGHT + NODE_GAP;
      if (curr.position.y < minY) {
        const idx = result.findIndex((n) => n.id === curr.id);
        if (idx !== -1) {
          result[idx] = {
            ...result[idx],
            position: { ...result[idx].position, y: minY },
          };
          curr.position = { ...curr.position, y: minY };
        }
      }
    }
  }

  return result;
}
