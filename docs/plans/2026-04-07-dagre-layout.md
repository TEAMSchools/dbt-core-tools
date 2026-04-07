# Lineage Graph Overhaul: Dagre + View Modes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the custom depth-grid layout with dagre, simplify the UX by removing expand/collapse and lock/reset/label toolbar, and add Dagster-style view modes (NN / upstream / downstream) with a depth selector. Switching files resets the graph entirely (like Dagster). Double-click background resets zoom.

**Architecture:** The lineage panel becomes stateless — every editor change or toolbar interaction triggers a full `resetCenter` with the appropriate mode/depth. The extension host (`lineagePanel.ts`) builds graph data using `buildGraphData` with mode+depth parameters. The webview (`App.tsx`) is a thin renderer: receives nodes+edges, runs dagre layout, renders via React Flow. Toolbar has view mode buttons and depth stepper. No expand/collapse, no lock, no incremental merging.

**Tech Stack:** `@dagrejs/dagre` v3 (MIT, ships types, 1 dep, ESM+CJS), existing React Flow + React

---

## File Structure

| File                                       | Action       | Responsibility                                                                                                                         |
| ------------------------------------------ | ------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`                             | **Modify**   | Add `@dagrejs/dagre`                                                                                                                   |
| `src/features/lineage/webview/layout.ts`   | **Rewrite**  | Single `layoutGraph` function using dagre. Delete `layoutExpand`, `resolveCollisions`                                                  |
| `src/features/lineage/webview/types.ts`    | **Modify**   | Remove expand-related fields from `GraphNodeData`, add `ViewMode` type                                                                 |
| `src/features/lineage/webview/App.tsx`     | **Rewrite**  | Remove expand/collapse/lock/merge logic. Add toolbar with view mode + depth. Double-click to fit view                                  |
| `src/features/lineage/webview/DbtNode.tsx` | **Simplify** | Remove expand/collapse buttons. Keep click, context menu, badges                                                                       |
| `src/features/lineage/webview/styles.css`  | **Simplify** | Remove expand button and lock/reset/label styles. Add view mode toolbar styles                                                         |
| `src/features/lineage/lineagePanel.ts`     | **Simplify** | Remove `mergeGraph`/`collapseDirection`/`highlightCenter` messages. `buildGraphData` takes mode+depth. Every update is a `resetCenter` |
| `test/unit/layout.test.ts`                 | **Rewrite**  | Test dagre layout behavior                                                                                                             |
| `test/unit/lineagePanel.test.ts`           | **Create**   | Test `buildGraphData` with different modes and depths                                                                                  |

### What gets deleted

- `layoutExpand`, `resolveCollisions` from `layout.ts`
- `mergeGraph`, `collapseDirection`, `highlightCenter` message types (extension→webview)
- `expand`, `collapseDirection` message types (webview→extension)
- `expandedRef`, `expandChildrenRef`, `edgesRef`, `currentNodeIdRef` from `App.tsx`
- `expandedUpstream`, `expandedDownstream`, `hasUpstream`, `hasDownstream` from `GraphNodeData`
- Expand/collapse buttons from `DbtNode.tsx`
- Lock checkbox, reset button, center label from toolbar
- `.expand-btn`, `.lock-label`, `.reset-btn`, `.center-label` CSS

---

### Task 1: Install dagre

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Install**

```bash
cd /workspaces/dbt-core-tools && npm install @dagrejs/dagre
```

- [ ] **Step 2: Verify build**

```bash
cd /workspaces/dbt-core-tools && npm run build
```

Expected: Clean build. Dagre gets bundled into `dist/lineage.js`.

- [ ] **Step 3: Run existing tests**

```bash
cd /workspaces/dbt-core-tools && npm test
```

Expected: All pass (nothing changed yet).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add @dagrejs/dagre for lineage layout"
```

---

### Task 2: Rewrite `layout.ts` with dagre

**Files:**

- Rewrite: `src/features/lineage/webview/layout.ts`
- Rewrite: `test/unit/layout.test.ts`

- [ ] **Step 1: Write the new test file**

```typescript
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

  it("stacks siblings vertically without overlap", () => {
    const nodes = [makeNode("a"), makeNode("b"), makeNode("c")];
    const edges = [makeEdge("a", "b"), makeEdge("a", "c")];
    const result = layoutGraph(nodes, edges);
    const b = result.nodes.find((n: any) => n.id === "b")!;
    const c = result.nodes.find((n: any) => n.id === "c")!;
    const gap = Math.abs(b.position.y - c.position.y);
    assert.ok(gap >= NODE_HEIGHT, `siblings should not overlap: gap=${gap}`);
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
    const ys = new Set(childNodes.map((n: any) => n.position.y));
    assert.equal(ys.size, 5, "all children should have distinct y positions");
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /workspaces/dbt-core-tools && npm test
```

Expected: Fails because `layoutGraph` signature and behavior differ.

- [ ] **Step 3: Rewrite `layout.ts`**

Replace the full contents of `src/features/lineage/webview/layout.ts`:

```typescript
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
```

- [ ] **Step 4: Run tests and build**

```bash
cd /workspaces/dbt-core-tools && npm test && npm run build
```

Expected: All pass, clean build.

- [ ] **Step 5: Commit**

```bash
git add src/features/lineage/webview/layout.ts test/unit/layout.test.ts
git commit -m "feat: replace custom grid layout with dagre"
```

---

### Task 3: Simplify `types.ts` and add view mode type

**Files:**

- Modify: `src/features/lineage/webview/types.ts`

- [ ] **Step 1: Rewrite types**

Replace the full contents of `src/features/lineage/webview/types.ts`:

```typescript
export type ViewMode = "nn" | "upstream" | "downstream";

export interface GraphNodeData {
  [key: string]: unknown;
  id: string;
  name: string;
  resourceType: string;
  materialization: string;
  contractEnforced: boolean;
  testCount: number;
  isCurrent: boolean;
}
```

Removed: `hasUpstream`, `hasDownstream`, `expandedUpstream`, `expandedDownstream`, `depth`.

- [ ] **Step 2: Build to check for type errors**

```bash
cd /workspaces/dbt-core-tools && npm run build
```

Expected: Type errors in `App.tsx`, `DbtNode.tsx`, `lineagePanel.ts` — these files still reference the removed fields. That's expected; we fix them in the next tasks.

- [ ] **Step 3: Commit**

```bash
git add src/features/lineage/webview/types.ts
git commit -m "refactor: simplify GraphNodeData, add ViewMode type"
```

---

### Task 4: Simplify `DbtNode.tsx` — remove expand/collapse buttons

**Files:**

- Modify: `src/features/lineage/webview/DbtNode.tsx`

- [ ] **Step 1: Rewrite `DbtNode.tsx`**

Replace the full contents:

```tsx
import { memo, useCallback } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import type { GraphNodeData } from "./types";

const BORDER_MAP: Record<string, string> = {
  model: "#64b5f6",
  source: "#4ecdc4",
  seed: "#4ecdc4",
  snapshot: "#ffcc80",
  exposure: "#ce93d8",
  metric: "#ce93d8",
  semantic_model: "#ce93d8",
};

const FILL_MAP: Record<string, string> = {
  model: "#1b2a3e",
  source: "#1b3a36",
  seed: "#1b3a36",
  snapshot: "#2e2518",
  exposure: "#2a1b2e",
  metric: "#2a1b2e",
  semantic_model: "#2a1b2e",
};

function DbtNode({ data }: NodeProps<Node<GraphNodeData>>) {
  const border = BORDER_MAP[data.resourceType] ?? "#6e6e6e";
  const fill = FILL_MAP[data.resourceType] ?? "#2a2a2a";

  const onClick = useCallback(() => {
    const vscode = (window as any).vscodeApi;
    if (!vscode) return;
    vscode.postMessage({ type: "openFile", nodeId: data.id });
  }, [data.id]);

  const onContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      window.dispatchEvent(
        new CustomEvent("dbt-context-menu", {
          detail: { nodeId: data.id, x: e.clientX, y: e.clientY },
        }),
      );
    },
    [data.id],
  );

  const maxNameLen = 20;
  const displayName =
    data.name.length > maxNameLen
      ? data.name.slice(0, maxNameLen - 1) + "\u2026"
      : data.name;

  const hasBadges = data.contractEnforced || data.testCount > 0;

  return (
    <div
      className={`dbt-node${data.isCurrent ? " current" : ""}`}
      style={{
        background: fill,
        borderColor: border,
        borderWidth: data.isCurrent ? "2px" : "1.5px",
        borderStyle: "solid",
        borderRadius: 6,
      }}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{ visibility: "hidden" }}
      />
      <Handle
        type="source"
        position={Position.Right}
        style={{ visibility: "hidden" }}
      />

      <div className="node-name">{displayName}</div>
      {data.materialization && (
        <div className="node-mat">{data.materialization}</div>
      )}

      {hasBadges && (
        <div className="node-badges">
          {data.contractEnforced && (
            <span
              className="node-pill"
              style={{
                borderColor: border,
                color: border,
                background: `${border}40`,
              }}
              title="Contract enforced"
            >
              <i className="codicon codicon-shield" />
            </span>
          )}
          {data.testCount > 0 && (
            <span
              className="node-pill"
              style={{
                borderColor: border,
                color: border,
                background: `${border}40`,
              }}
              title={`${data.testCount} tests`}
            >
              <i className="codicon codicon-beaker" />
              {data.testCount}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default memo(DbtNode);
```

- [ ] **Step 2: Commit**

```bash
git add src/features/lineage/webview/DbtNode.tsx
git commit -m "refactor: remove expand/collapse buttons from DbtNode"
```

---

### Task 5: Rewrite `App.tsx` — stateless renderer with view mode toolbar

**Files:**

- Rewrite: `src/features/lineage/webview/App.tsx`

This is the biggest change. The new `App.tsx`:

- Receives only `resetCenter` messages (no merge/collapse/highlight)
- Sends `changeView` messages when toolbar changes (mode, depth)
- Sends `resetCenter` on mount (ready signal)
- Double-click on background calls `fitView`
- Toolbar: 3 view mode buttons + depth stepper

- [ ] **Step 1: Rewrite `App.tsx`**

Replace the full contents:

```tsx
import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ReactFlow,
  ReactFlowProvider,
  type Node,
  type Edge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  Controls,
  Background,
  BackgroundVariant,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "@vscode/codicons/dist/codicon.css";
import DbtNode from "./DbtNode";
import { layoutGraph } from "./layout";
import type { GraphNodeData, ViewMode } from "./types";

const nodeTypes = { dbtNode: DbtNode };

const vscodeApi = (window as any).acquireVsCodeApi();
(window as any).vscodeApi = vscodeApi;

interface IncomingNode {
  id: string;
  name: string;
  resourceType: string;
  materialization: string;
  contractEnforced: boolean;
  testCount: number;
}

interface IncomingEdge {
  source: string;
  target: string;
}

const VIEW_MODE_LABELS: Record<ViewMode, string> = {
  nn: "NN",
  upstream: "Upstream",
  downstream: "Downstream",
};

function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<GraphNodeData>>(
    [],
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [emptyMessage, setEmptyMessage] = useState(
    "No lineage data available.",
  );
  const [viewMode, setViewMode] = useState<ViewMode>("nn");
  const [depth, setDepth] = useState(1);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    nodeId: string;
  } | null>(null);
  const { fitView } = useReactFlow();

  const applyGraph = useCallback(
    (
      incomingNodes: IncomingNode[],
      incomingEdges: IncomingEdge[],
      currentNodeId: string | null,
    ) => {
      const flowNodes: Node<GraphNodeData>[] = incomingNodes.map((n) => ({
        id: n.id,
        type: "dbtNode",
        position: { x: 0, y: 0 },
        data: {
          ...n,
          isCurrent: n.id === currentNodeId,
        } as GraphNodeData,
      }));

      const flowEdges: Edge[] = incomingEdges.map((e) => ({
        id: `e-${e.source}-${e.target}`,
        source: e.source,
        target: e.target,
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { stroke: "#555" },
      }));

      const { nodes: positioned, edges: layoutEdges } = layoutGraph(
        flowNodes,
        flowEdges,
      );
      setNodes(positioned);
      setEdges(layoutEdges);
    },
    [setNodes, setEdges],
  );

  // Message handler from extension host
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data;
      if (!msg || msg.type !== "resetCenter") return;

      setEmptyMessage(msg.emptyMessage ?? "No lineage data available.");

      // Sync toolbar state if the extension tells us (e.g. on initial load)
      if (msg.viewMode) setViewMode(msg.viewMode);
      if (msg.depth != null) setDepth(msg.depth);

      applyGraph(msg.nodes ?? [], msg.edges ?? [], msg.currentNodeId ?? null);
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [applyGraph]);

  // Context menu from DbtNode custom events
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setContextMenu({ x: detail.x, y: detail.y, nodeId: detail.nodeId });
    };
    window.addEventListener("dbt-context-menu", handler);
    return () => window.removeEventListener("dbt-context-menu", handler);
  }, []);

  // Signal ready to extension
  useEffect(() => {
    vscodeApi.postMessage({ type: "ready" });
  }, []);

  const changeView = useCallback((newMode: ViewMode, newDepth: number) => {
    setViewMode(newMode);
    setDepth(newDepth);
    vscodeApi.postMessage({
      type: "changeView",
      viewMode: newMode,
      depth: newDepth,
    });
  }, []);

  const onModeClick = useCallback(
    (mode: ViewMode) => changeView(mode, depth),
    [changeView, depth],
  );

  const onDepthChange = useCallback(
    (delta: number) => {
      const newDepth = Math.max(1, depth + delta);
      changeView(viewMode, newDepth);
    },
    [changeView, viewMode, depth],
  );

  const onPaneDoubleClick = useCallback(() => {
    fitView({ duration: 300 });
  }, [fitView]);

  const hideContextMenu = useCallback(() => setContextMenu(null), []);

  const handleContextAction = useCallback(
    (action: string) => {
      if (contextMenu) {
        vscodeApi.postMessage({ type: action, nodeId: contextMenu.nodeId });
        setContextMenu(null);
      }
    },
    [contextMenu],
  );

  if (nodes.length === 0) {
    return (
      <div className="empty-state">
        <p>{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: "100%" }} onClick={hideContextMenu}>
      <div className="toolbar">
        <div className="view-mode-group">
          {(Object.keys(VIEW_MODE_LABELS) as ViewMode[]).map((mode) => (
            <button
              key={mode}
              className={`view-mode-btn${viewMode === mode ? " active" : ""}`}
              onClick={() => onModeClick(mode)}
            >
              {VIEW_MODE_LABELS[mode]}
            </button>
          ))}
        </div>
        <div className="depth-group">
          <button
            className="depth-btn"
            onClick={() => onDepthChange(-1)}
            disabled={depth <= 1}
          >
            −
          </button>
          <span className="depth-label">{depth}</span>
          <button className="depth-btn" onClick={() => onDepthChange(1)}>
            +
          </button>
        </div>
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        onPaneClick={hideContextMenu}
        onDoubleClick={onPaneDoubleClick}
        fitView
        minZoom={0.1}
        maxZoom={3}
        proOptions={{ hideAttribution: true }}
      >
        <Controls showInteractive={false} />
        <Background
          variant={BackgroundVariant.Dots}
          color="#333"
          gap={20}
          size={1}
        />
      </ReactFlow>
      {contextMenu && (
        <div
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <ul>
            <li onClick={() => handleContextAction("openFile")}>Open File</li>
            <li onClick={() => handleContextAction("toggleProperties")}>
              Toggle SQL/Properties
            </li>
            <li className="separator" />
            <li onClick={() => handleContextAction("runModel")}>Run Model</li>
            <li onClick={() => handleContextAction("buildModel")}>
              Build Model
            </li>
            <li onClick={() => handleContextAction("testModel")}>Test Model</li>
            <li onClick={() => handleContextAction("showModel")}>Show Model</li>
          </ul>
        </div>
      )}
    </div>
  );
}

const container = document.getElementById("react-root");
if (container) {
  createRoot(container).render(
    <ReactFlowProvider>
      <App />
    </ReactFlowProvider>,
  );
}
```

- [ ] **Step 2: Build to check for compilation errors**

```bash
cd /workspaces/dbt-core-tools && npm run build
```

Expected: May have errors in `lineagePanel.ts` (still sending old message types). That's fixed in Task 7.

- [ ] **Step 3: Commit**

```bash
git add src/features/lineage/webview/App.tsx
git commit -m "feat: stateless App with view mode toolbar, double-click fit"
```

---

### Task 6: Simplify `styles.css`

**Files:**

- Modify: `src/features/lineage/webview/styles.css`

- [ ] **Step 1: Rewrite `styles.css`**

Replace the full contents:

```css
/* dbt Core Tools — Lineage Viewer styles (dark theme) */

* {
  box-sizing: border-box;
}

html,
body,
#react-root {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background-color: #1a1a2e;
  color: #e0e0e0;
  font-family: var(--vscode-font-family, system-ui);
  font-size: var(--vscode-font-size, 13px);
}

/* ---- Toolbar ---- */

.toolbar {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 8px;
  background-color: rgba(26, 26, 46, 0.9);
  border: 1px solid #333;
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 0.85em;
}

/* View mode button group */

.view-mode-group {
  display: flex;
  gap: 0;
}

.view-mode-btn {
  background: transparent;
  color: #aaa;
  border: 1px solid #444;
  padding: 2px 8px;
  cursor: pointer;
  font-size: 0.85em;
  font-family: inherit;
}

.view-mode-btn:first-child {
  border-radius: 3px 0 0 3px;
}

.view-mode-btn:last-child {
  border-radius: 0 3px 3px 0;
}

.view-mode-btn:not(:first-child) {
  border-left: none;
}

.view-mode-btn.active {
  background: var(--vscode-button-background, #0e639c);
  color: var(--vscode-button-foreground, #fff);
  border-color: var(--vscode-button-background, #0e639c);
}

.view-mode-btn:hover:not(.active) {
  background: rgba(255, 255, 255, 0.05);
  color: #e0e0e0;
}

/* Depth stepper */

.depth-group {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: 4px;
  border-left: 1px solid #444;
  padding-left: 8px;
}

.depth-btn {
  background: transparent;
  color: #aaa;
  border: 1px solid #444;
  border-radius: 3px;
  width: 22px;
  height: 22px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  line-height: 1;
  font-family: inherit;
}

.depth-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.05);
  color: #e0e0e0;
}

.depth-btn:disabled {
  opacity: 0.3;
  cursor: default;
}

.depth-label {
  color: #e0e0e0;
  min-width: 16px;
  text-align: center;
  font-variant-numeric: tabular-nums;
}

/* ---- Custom nodes ---- */

.dbt-node {
  position: relative;
  font-family: var(--vscode-font-family, system-ui);
  width: 160px;
  height: 64px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 6px 12px;
  cursor: pointer;
}

.dbt-node.current {
  box-shadow: 0 0 8px rgba(100, 181, 246, 0.3);
}

.node-name {
  font-size: 12px;
  font-weight: 600;
  color: #e0e0e0;
  text-align: center;
  white-space: nowrap;
}

.node-mat {
  font-size: 10px;
  color: #888;
  text-align: center;
  margin-top: 1px;
}

/* ---- Badges ---- */

.node-badges {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 16px;
  margin-top: 2px;
}

.node-pill {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  border: 1px solid;
  border-radius: 8px;
  padding: 0 6px;
  font-size: 9px;
  height: 16px;
  line-height: 16px;
}

.node-pill .codicon {
  font-size: 10px;
}

/* ---- Context menu ---- */

.context-menu {
  position: fixed;
  z-index: 100;
  background-color: #252536;
  border: 1px solid #444;
  border-radius: 4px;
  padding: 4px 0;
  min-width: 160px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
}

.context-menu ul {
  list-style: none;
  margin: 0;
  padding: 0;
}

.context-menu li {
  padding: 5px 14px;
  cursor: pointer;
  color: #e0e0e0;
  font-size: 0.9em;
  white-space: nowrap;
}

.context-menu li:hover {
  background-color: rgba(100, 181, 246, 0.15);
}

.context-menu li.separator {
  border-top: 1px solid #444;
  margin: 3px 0;
  padding: 0;
  cursor: default;
}

.context-menu li.separator:hover {
  background-color: transparent;
}

/* ---- Empty state ---- */

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  color: #888;
}

/* ---- React Flow overrides ---- */

.react-flow__background {
  background-color: #1a1a2e !important;
}

.react-flow__controls button {
  background-color: #252536 !important;
  color: #e0e0e0 !important;
  border: 1px solid #444 !important;
}

.react-flow__controls button:hover {
  background-color: #333 !important;
}

.react-flow__controls button svg {
  fill: #e0e0e0 !important;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/features/lineage/webview/styles.css
git commit -m "refactor: remove expand/lock/reset styles, add view mode toolbar"
```

---

### Task 7: Rewrite `lineagePanel.ts` — mode-aware graph building, simplified protocol

**Files:**

- Modify: `src/features/lineage/lineagePanel.ts`

This is the extension-host side. Key changes:

- `buildGraphData` takes `mode` ("nn" | "upstream" | "downstream") and `depth`
- `nn` mode traverses both directions; `upstream`/`downstream` traverse one direction only
- Remove `mergeGraph`, `collapseDirection`, `highlightCenter` message handling
- Add `changeView` message handler
- `updateCenter()` now sends `resetCenter` (full rebuild) instead of `highlightCenter`
- Store current `viewMode` and `depth` as instance state on `LineageViewProvider`
- Remove `hasUpstream`, `hasDownstream`, `expandedUpstream`, `expandedDownstream` from `GraphNode`

- [ ] **Step 1: Rewrite `lineagePanel.ts`**

Replace the full contents:

```typescript
/**
 * Lineage Viewer — persistent bottom panel using WebviewViewProvider.
 *
 * Renders a DAG of upstream/downstream dependencies for the active model.
 * Every editor change or view-mode change triggers a full graph rebuild.
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { getActiveProject } from "../../extension";
import { DbtProject } from "../../core/project";
import { safeJoinPath } from "../../utils/paths";
import type { ViewMode } from "./webview/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GraphNode {
  id: string;
  name: string;
  resourceType: string;
  materialization: string;
  contractEnforced: boolean;
  testCount: number;
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ---------------------------------------------------------------------------
// LineageViewProvider
// ---------------------------------------------------------------------------

export class LineageViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "dbtCoreTools.lineageView";

  private _view: vscode.WebviewView | undefined;
  private _ready = false;
  private _pendingMessage: unknown | null = null;
  private _viewMode: ViewMode = "nn";
  private _depth = 1;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this._view = webviewView;
    this._ready = false;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(
          this._extensionUri,
          "src",
          "features",
          "lineage",
          "webview",
        ),
        vscode.Uri.joinPath(this._extensionUri, "dist"),
      ],
    };

    webviewView.webview.html = this._buildHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (message) => {
      if (message?.type === "ready") {
        this._ready = true;
        if (this._pendingMessage) {
          webviewView.webview.postMessage(this._pendingMessage);
          this._pendingMessage = null;
        }
        return;
      }
      await this._handleMessage(message);
    });

    webviewView.onDidDispose(() => {
      this._view = undefined;
      this._ready = false;
      this._pendingMessage = null;
    });

    this._sendResetCenter();
  }

  /**
   * Rebuilds the graph for the active editor's model.
   * Called on editor focus change and manifest reload.
   */
  async updateCenter(): Promise<void> {
    await this._sendResetCenter();
  }

  /**
   * Alias for updateCenter — both do a full rebuild now.
   */
  async refreshGraph(): Promise<void> {
    await this._sendResetCenter();
  }

  private async _sendResetCenter(): Promise<void> {
    if (!this._view) return;

    const project = getActiveProject();
    if (!project) {
      this._postMessage({
        type: "resetCenter",
        nodes: [],
        edges: [],
        currentNodeId: null,
        viewMode: this._viewMode,
        depth: this._depth,
        emptyMessage: "No active dbt project",
      });
      return;
    }

    await project.ensureLoaded();

    const nodeId = this._getActiveNodeId(project);
    if (!nodeId) {
      this._postMessage({
        type: "resetCenter",
        nodes: [],
        edges: [],
        currentNodeId: null,
        viewMode: this._viewMode,
        depth: this._depth,
        emptyMessage: "No dbt model found for this file",
      });
      return;
    }

    const graphData = buildGraphData(
      project,
      nodeId,
      this._viewMode,
      this._depth,
    );
    this._postMessage({
      type: "resetCenter",
      nodes: graphData.nodes,
      edges: graphData.edges,
      currentNodeId: nodeId,
      viewMode: this._viewMode,
      depth: this._depth,
    });
  }

  private _postMessage(message: unknown): void {
    if (!this._view) return;
    if (!this._ready) {
      this._pendingMessage = message;
      return;
    }
    this._view.webview.postMessage(message);
  }

  private _getActiveNodeId(project: DbtProject): string | null {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return null;
    const filePath = editor.document.uri.fsPath;
    const node = project.findNodeByFilePath(filePath);
    if (node) return node.unique_id;
    const source = project.findSourceByFilePath(filePath);
    return source?.unique_id ?? null;
  }

  private async _handleMessage(message: {
    type: string;
    nodeId?: string;
    viewMode?: ViewMode;
    depth?: number;
  }): Promise<void> {
    if (!message || !message.type) return;
    const { type, nodeId } = message;

    switch (type) {
      case "resetCenter":
        await this._sendResetCenter();
        break;
      case "changeView":
        if (message.viewMode) this._viewMode = message.viewMode;
        if (message.depth != null) this._depth = message.depth;
        await this._sendResetCenter();
        break;
      case "openFile": {
        if (!nodeId) return;
        const filePath = resolveNodeFilePath(nodeId);
        if (filePath) {
          const doc = await vscode.workspace.openTextDocument(filePath);
          await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
        }
        break;
      }
      case "runModel":
        await vscode.commands.executeCommand("dbtCoreTools.runModel");
        break;
      case "buildModel":
        await vscode.commands.executeCommand("dbtCoreTools.buildModel");
        break;
      case "testModel":
        await vscode.commands.executeCommand("dbtCoreTools.testModel");
        break;
      case "showModel":
        await vscode.commands.executeCommand("dbtCoreTools.showModel");
        break;
      case "toggleProperties":
        await vscode.commands.executeCommand("dbtCoreTools.toggleProperties");
        break;
    }
  }

  private _buildHtml(webview: vscode.Webview): string {
    const webviewDir = vscode.Uri.joinPath(
      this._extensionUri,
      "src",
      "features",
      "lineage",
      "webview",
    );

    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(webviewDir, "styles.css"),
    );
    const bundledStyleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "dist", "lineage.css"),
    );
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "dist", "lineage.js"),
    );
    const cspSource = webview.cspSource;

    const htmlPath = path.join(
      this._extensionUri.fsPath,
      "src",
      "features",
      "lineage",
      "webview",
      "index.html",
    );

    let html = fs.readFileSync(htmlPath, "utf8");
    html = html
      .replace(/\{\{styleUri\}\}/g, styleUri.toString())
      .replace(/\{\{bundledStyleUri\}\}/g, bundledStyleUri.toString())
      .replace(/\{\{scriptUri\}\}/g, scriptUri.toString())
      .replace(/\{\{cspSource\}\}/g, cspSource);

    return html;
  }
}

// ---------------------------------------------------------------------------
// Graph building
// ---------------------------------------------------------------------------

export function buildGraphData(
  project: DbtProject,
  centerId: string,
  mode: ViewMode,
  depth: number,
): GraphData {
  const childMap = project.getChildMap();
  const parentMap = project.getParentMap();
  const nodes = project.getNodes();
  const sources = project.getSources();

  // Supplement child_map for sources (see original rationale in git history).
  const supplementedChildMap: Record<string, string[]> = { ...childMap };
  for (const [nodeId, parents] of Object.entries(parentMap)) {
    for (const parentId of parents) {
      if (parentId.startsWith("source.")) {
        if (!supplementedChildMap[parentId]) {
          supplementedChildMap[parentId] = [];
        }
        if (!supplementedChildMap[parentId].includes(nodeId)) {
          supplementedChildMap[parentId].push(nodeId);
        }
      }
    }
  }

  const visitedNodes = new Set<string>();
  const edges: GraphEdge[] = [];

  function isTest(id: string): boolean {
    return id.startsWith("test.");
  }

  function expandUpstream(id: string, remaining: number): void {
    if (remaining <= 0) return;
    const parents = parentMap[id] ?? [];
    for (const parentId of parents) {
      if (isTest(parentId)) continue;
      if (!visitedNodes.has(parentId)) {
        visitedNodes.add(parentId);
        expandUpstream(parentId, remaining - 1);
      }
      edges.push({ source: parentId, target: id });
    }
  }

  function expandDownstream(id: string, remaining: number): void {
    if (remaining <= 0) return;
    const children = supplementedChildMap[id] ?? [];
    for (const childId of children) {
      if (isTest(childId)) continue;
      if (!visitedNodes.has(childId)) {
        visitedNodes.add(childId);
        expandDownstream(childId, remaining - 1);
      }
      edges.push({ source: id, target: childId });
    }
  }

  visitedNodes.add(centerId);

  if (mode === "nn" || mode === "upstream") {
    expandUpstream(centerId, depth);
  }
  if (mode === "nn" || mode === "downstream") {
    expandDownstream(centerId, depth);
  }

  // Deduplicate edges.
  const edgeSet = new Set<string>();
  const uniqueEdges: GraphEdge[] = [];
  for (const edge of edges) {
    const key = `${edge.source}\u2192${edge.target}`;
    if (!edgeSet.has(key)) {
      edgeSet.add(key);
      uniqueEdges.push(edge);
    }
  }

  // Count test children per node.
  const testCounts = new Map<string, number>();
  for (const id of visitedNodes) {
    const children = supplementedChildMap[id] ?? [];
    const count = children.filter((c) => isTest(c)).length;
    if (count > 0) testCounts.set(id, count);
  }

  const graphNodes: GraphNode[] = [];
  for (const id of visitedNodes) {
    const tc = testCounts.get(id) ?? 0;
    const node = nodes[id];
    if (node) {
      graphNodes.push({
        id: node.unique_id,
        name: node.name,
        resourceType: node.resource_type,
        materialization:
          (node.config?.["materialized"] as string | undefined) ?? "",
        contractEnforced: node.contract?.enforced ?? false,
        testCount: tc,
      });
      continue;
    }
    const source = sources[id];
    if (source) {
      graphNodes.push({
        id: source.unique_id,
        name: source.name,
        resourceType: source.resource_type,
        materialization: "",
        contractEnforced: false,
        testCount: tc,
      });
      continue;
    }
    const resourceType = id.split(".")[0] ?? "unknown";
    const fallbackName = id.split(".").slice(2).join(".") || id;
    graphNodes.push({
      id,
      name: fallbackName,
      resourceType,
      materialization: "",
      contractEnforced: false,
      testCount: tc,
    });
  }

  return { nodes: graphNodes, edges: uniqueEdges };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveNodeFilePath(nodeId: string): string | null {
  const project = getActiveProject();
  if (!project) return null;

  const nodes = project.getNodes();
  const sources = project.getSources();

  const node = nodes[nodeId];
  if (node) {
    const abs = path.isAbsolute(node.original_file_path)
      ? node.original_file_path
      : safeJoinPath(project.rootPath, node.original_file_path);
    return abs && fs.existsSync(abs) ? abs : null;
  }

  const source = sources[nodeId];
  if (source) {
    const abs = path.isAbsolute(source.original_file_path)
      ? source.original_file_path
      : safeJoinPath(project.rootPath, source.original_file_path);
    return abs && fs.existsSync(abs) ? abs : null;
  }

  return null;
}
```

- [ ] **Step 2: Build**

```bash
cd /workspaces/dbt-core-tools && npm run build
```

Expected: Clean build.

- [ ] **Step 3: Run tests**

```bash
cd /workspaces/dbt-core-tools && npm test
```

Expected: All pass. (The `lineagePanel.ts` module is only tested indirectly via `buildGraphData` — if there's an existing test that imports the old `GraphNode` type with `hasUpstream`/etc., it will need updating. Check for compilation errors.)

- [ ] **Step 4: Commit**

```bash
git add src/features/lineage/lineagePanel.ts
git commit -m "feat: mode-aware graph building (nn/upstream/downstream + depth)"
```

---

### Task 8: Write `buildGraphData` tests

**Files:**

- Create: `test/unit/lineagePanel.test.ts`

Since `lineagePanel.ts` statically imports `vscode`, we need the `Module._resolveFilename` stub pattern (per CLAUDE.md). However, `buildGraphData` is a pure function that only depends on `DbtProject` methods — we can test it by mocking the project.

- [ ] **Step 1: Write the test file**

```typescript
import { strict as assert } from "node:assert";
import Module from "node:module";

// Stub vscode before importing lineagePanel (it has `import * as vscode`).
const vscodeStub = {
  Uri: { joinPath: (...args: any[]) => ({ fsPath: args.join("/") }) },
  window: { activeTextEditor: undefined },
  workspace: {},
  commands: {},
  ViewColumn: { One: 1 },
};

const origResolveFilename = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (request: string, ...args: any[]) {
  if (request === "vscode") {
    return require.resolve("./vscodeStub");
  }
  return origResolveFilename.call(this, request, ...args);
};

// Write a tiny stub file for the resolver to find.
import * as fs from "fs";
import * as path from "path";
const stubPath = path.join(__dirname, "vscodeStub.js");
if (!fs.existsSync(stubPath)) {
  fs.writeFileSync(stubPath, `module.exports = ${JSON.stringify(vscodeStub)};`);
}

import { buildGraphData } from "../../src/features/lineage/lineagePanel";

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

describe("buildGraphData", () => {
  afterAll(() => {
    // Clean up stub file
    if (fs.existsSync(stubPath)) fs.unlinkSync(stubPath);
  });

  it("returns center node with no edges for depth 0", () => {
    const project = makeMockProject({
      nodes: {
        "model.p.a": {
          unique_id: "model.p.a",
          name: "a",
          resource_type: "model",
          config: { materialized: "view" },
          contract: { enforced: false },
        },
      },
      childMap: { "model.p.a": ["model.p.b"] },
    });
    // depth 0 should only return the center node (no traversal)
    // Actually our traversal uses remaining > 0, so depth=1 with nn gives 1 level each way
    const result = buildGraphData(project, "model.p.a", "nn", 0);
    assert.equal(result.nodes.length, 1);
    assert.equal(result.edges.length, 0);
  });

  it("nn mode traverses both directions", () => {
    const project = makeMockProject({
      nodes: {
        "model.p.a": {
          unique_id: "model.p.a",
          name: "a",
          resource_type: "model",
          config: {},
          contract: {},
        },
        "model.p.b": {
          unique_id: "model.p.b",
          name: "b",
          resource_type: "model",
          config: {},
          contract: {},
        },
        "model.p.c": {
          unique_id: "model.p.c",
          name: "c",
          resource_type: "model",
          config: {},
          contract: {},
        },
      },
      parentMap: { "model.p.b": ["model.p.a"] },
      childMap: { "model.p.b": ["model.p.c"] },
    });
    const result = buildGraphData(project, "model.p.b", "nn", 1);
    assert.equal(result.nodes.length, 3);
    assert.equal(result.edges.length, 2);
  });

  it("upstream mode only traverses upstream", () => {
    const project = makeMockProject({
      nodes: {
        "model.p.a": {
          unique_id: "model.p.a",
          name: "a",
          resource_type: "model",
          config: {},
          contract: {},
        },
        "model.p.b": {
          unique_id: "model.p.b",
          name: "b",
          resource_type: "model",
          config: {},
          contract: {},
        },
        "model.p.c": {
          unique_id: "model.p.c",
          name: "c",
          resource_type: "model",
          config: {},
          contract: {},
        },
      },
      parentMap: { "model.p.b": ["model.p.a"] },
      childMap: { "model.p.b": ["model.p.c"] },
    });
    const result = buildGraphData(project, "model.p.b", "upstream", 1);
    const ids = result.nodes.map((n: any) => n.id);
    assert.ok(ids.includes("model.p.a"), "should include upstream node");
    assert.ok(!ids.includes("model.p.c"), "should NOT include downstream node");
  });

  it("downstream mode only traverses downstream", () => {
    const project = makeMockProject({
      nodes: {
        "model.p.a": {
          unique_id: "model.p.a",
          name: "a",
          resource_type: "model",
          config: {},
          contract: {},
        },
        "model.p.b": {
          unique_id: "model.p.b",
          name: "b",
          resource_type: "model",
          config: {},
          contract: {},
        },
        "model.p.c": {
          unique_id: "model.p.c",
          name: "c",
          resource_type: "model",
          config: {},
          contract: {},
        },
      },
      parentMap: { "model.p.b": ["model.p.a"] },
      childMap: { "model.p.b": ["model.p.c"] },
    });
    const result = buildGraphData(project, "model.p.b", "downstream", 1);
    const ids = result.nodes.map((n: any) => n.id);
    assert.ok(!ids.includes("model.p.a"), "should NOT include upstream node");
    assert.ok(ids.includes("model.p.c"), "should include downstream node");
  });

  it("respects depth limit", () => {
    const project = makeMockProject({
      nodes: {
        "model.p.a": {
          unique_id: "model.p.a",
          name: "a",
          resource_type: "model",
          config: {},
          contract: {},
        },
        "model.p.b": {
          unique_id: "model.p.b",
          name: "b",
          resource_type: "model",
          config: {},
          contract: {},
        },
        "model.p.c": {
          unique_id: "model.p.c",
          name: "c",
          resource_type: "model",
          config: {},
          contract: {},
        },
      },
      childMap: {
        "model.p.a": ["model.p.b"],
        "model.p.b": ["model.p.c"],
      },
    });
    const depth1 = buildGraphData(project, "model.p.a", "downstream", 1);
    assert.equal(depth1.nodes.length, 2, "depth 1 should get a + b");

    const depth2 = buildGraphData(project, "model.p.a", "downstream", 2);
    assert.equal(depth2.nodes.length, 3, "depth 2 should get a + b + c");
  });

  it("excludes test nodes", () => {
    const project = makeMockProject({
      nodes: {
        "model.p.a": {
          unique_id: "model.p.a",
          name: "a",
          resource_type: "model",
          config: {},
          contract: {},
        },
      },
      childMap: { "model.p.a": ["test.p.t1", "test.p.t2"] },
    });
    const result = buildGraphData(project, "model.p.a", "downstream", 1);
    assert.equal(result.nodes.length, 1, "tests should be excluded from nodes");
    assert.equal(result.nodes[0].testCount, 2, "test count should be 2");
  });
});
```

- [ ] **Step 2: Run tests**

```bash
cd /workspaces/dbt-core-tools && npm test
```

Expected: All pass.

- [ ] **Step 3: Commit**

```bash
git add test/unit/lineagePanel.test.ts test/unit/vscodeStub.js
git commit -m "test: add buildGraphData tests for view modes and depth"
```

---

### Task 9: Update callers of `updateCenter` in `extension.ts`

**Files:**

- Modify: `src/extension.ts` (if needed)

The old `updateCenter()` only sent a lightweight `highlightCenter`. Now it sends a full `resetCenter`. Check that the call sites in `extension.ts` still make sense — they should, since we want every editor change to rebuild the graph.

- [ ] **Step 1: Search for `updateCenter` and `refreshGraph` calls**

```bash
cd /workspaces/dbt-core-tools && grep -rn "updateCenter\|refreshGraph" --include="*.ts" src/
```

- [ ] **Step 2: Verify the call pattern is correct**

`updateCenter` is likely called on `onDidChangeActiveTextEditor`. Previously it was lightweight (just highlight). Now it's a full rebuild — which is what we want (Dagster-style). Verify there's no throttling issue. If the editor-change listener fires frequently, consider adding a simple debounce (e.g. 150ms `setTimeout`).

- [ ] **Step 3: Add debounce if needed**

If `updateCenter` is called directly on editor change without debounce, wrap it:

In the relevant listener in `extension.ts`, find the `updateCenter` call and wrap it:

```typescript
let lineageDebounce: ReturnType<typeof setTimeout> | undefined;
vscode.window.onDidChangeActiveTextEditor(() => {
  clearTimeout(lineageDebounce);
  lineageDebounce = setTimeout(() => lineageProvider.updateCenter(), 150);
});
```

If there's already a debounce or similar pattern, leave it.

- [ ] **Step 4: Build and test**

```bash
cd /workspaces/dbt-core-tools && npm run build && npm test
```

- [ ] **Step 5: Commit (if changes were made)**

```bash
git add src/extension.ts
git commit -m "refactor: debounce lineage updateCenter on editor change"
```

---

## Verification

After all tasks, manually test:

1. Open a model file → lineage panel shows NN view at depth 1
2. Click "Upstream" → graph rebuilds showing only upstream nodes
3. Click "Downstream" → graph rebuilds showing only downstream nodes
4. Click depth "+" → graph expands to show deeper dependencies
5. Click depth "−" → graph contracts
6. Switch to a different model file → graph rebuilds entirely for new model
7. Double-click empty area → graph zooms to fit
8. Right-click a node → context menu works
9. Click a node → file opens in editor
10. Diamond/fan-out topologies → no overlapping nodes

## What we removed

- Expand/collapse buttons and all incremental graph merging
- Lock view toggle
- Reset button and center label
- `mergeGraph`, `collapseDirection`, `highlightCenter` messages
- `expandedRef`, `expandChildrenRef` state tracking
- `layoutExpand`, `resolveCollisions` functions
- `hasUpstream`, `hasDownstream`, `expandedUpstream`, `expandedDownstream`, `depth` from node data

## What we kept unchanged

- Node appearance (160×64 dark nodes, color borders, badges, materialization)
- Context menu (right-click → run/build/test/show/open/toggle)
- Click-to-open-file
- React Flow as renderer
- esbuild config
- Ready handshake protocol
