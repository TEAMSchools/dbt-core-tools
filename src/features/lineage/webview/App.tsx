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
  nn: "Nearest",
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
  const [maxDepth, setMaxDepth] = useState(1);
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
        style: { stroke: "var(--vscode-editorWidget-border, #555)" },
      }));

      const { nodes: positioned, edges: layoutEdges } = layoutGraph(
        flowNodes,
        flowEdges,
      );
      setNodes(positioned);
      setEdges(layoutEdges);
      // fitView prop only fires on mount; re-center after data changes
      requestAnimationFrame(() => fitView({ duration: 300 }));
    },
    [setNodes, setEdges, fitView],
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
      if (msg.maxDepth != null) setMaxDepth(msg.maxDepth);

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
      const current = depth === 0 ? maxDepth : depth;
      const newDepth = Math.max(1, Math.min(maxDepth, current + delta));
      changeView(viewMode, newDepth);
    },
    [changeView, viewMode, depth, maxDepth],
  );

  const onToggleAll = useCallback(() => {
    changeView(viewMode, depth === 0 ? maxDepth : 0);
  }, [changeView, viewMode, depth, maxDepth]);

  const onPaneDoubleClick = useCallback(
    (event?: React.MouseEvent) => {
      event?.stopPropagation();
      fitView({ duration: 300 });
    },
    [fitView],
  );

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
    <div
      style={{ width: "100%", height: "100%" }}
      onClick={hideContextMenu}
      onDoubleClick={onPaneDoubleClick}
    >
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
            className="toolbar-icon-btn build-all-btn"
            onClick={() =>
              vscodeApi.postMessage({
                type: "buildVisible",
                nodeIds: nodes.map((n) => n.id),
              })
            }
            title="Build visible nodes"
          >
            <i className="codicon codicon-rocket" />
          </button>
        </div>
        <div className="depth-group">
          <button
            className="toolbar-icon-btn depth-btn"
            onClick={() => onDepthChange(-1)}
            disabled={depth <= 1 && depth !== 0}
          >
            −
          </button>
          <span className="depth-label">{depth === 0 ? "All" : depth}</span>
          <button
            className="toolbar-icon-btn depth-btn"
            onClick={() => onDepthChange(1)}
            disabled={depth === 0 || depth >= maxDepth}
          >
            +
          </button>
          <button
            className={`toolbar-icon-btn depth-btn all-btn${depth === 0 ? " active" : ""}`}
            onClick={onToggleAll}
          >
            All
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
        onNodeDoubleClick={onPaneDoubleClick}
        zoomOnDoubleClick={false}
        fitView
        minZoom={0.1}
        maxZoom={3}
        proOptions={{ hideAttribution: true }}
      >
        <Controls showInteractive={false} />
        <Background
          variant={BackgroundVariant.Dots}
          color="var(--vscode-widget-border, #333)"
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
