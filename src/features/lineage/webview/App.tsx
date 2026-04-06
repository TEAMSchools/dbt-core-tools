import { useCallback, useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  ReactFlow,
  type Node,
  type Edge,
  useNodesState,
  useEdgesState,
  Controls,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import DbtNode from "./DbtNode";
import { layoutGraph } from "./layout";
import type { GraphNodeData } from "./types";

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
  hasUpstream: boolean;
  hasDownstream: boolean;
}

interface IncomingEdge {
  source: string;
  target: string;
}

function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<GraphNodeData>>(
    [],
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [locked, setLocked] = useState(true);
  const [currentNodeId, setCurrentNodeId] = useState<string | null>(null);
  const [emptyMessage, setEmptyMessage] = useState(
    "No lineage data available.",
  );
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    nodeId: string;
  } | null>(null);
  const expandedRef = useRef<
    Map<string, { upstream: boolean; downstream: boolean }>
  >(new Map());
  // Keep a ref to edges for use inside setNodes callback
  const edgesRef = useRef<Edge[]>([]);
  const currentNodeIdRef = useRef<string | null>(null);

  // Keep refs in sync
  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);
  useEffect(() => {
    currentNodeIdRef.current = currentNodeId;
  }, [currentNodeId]);

  const buildFlowNodes = useCallback(
    (
      incoming: IncomingNode[],
      centerId: string | null,
    ): Node<GraphNodeData>[] => {
      return incoming.map((n) => {
        const expanded = expandedRef.current.get(n.id) ?? {
          upstream: false,
          downstream: false,
        };
        return {
          id: n.id,
          type: "dbtNode",
          position: { x: 0, y: 0 },
          data: {
            ...n,
            isCurrent: n.id === centerId,
            expandedUpstream: expanded.upstream,
            expandedDownstream: expanded.downstream,
          } as GraphNodeData,
        };
      });
    },
    [],
  );

  const buildFlowEdges = useCallback((incoming: IncomingEdge[]): Edge[] => {
    return incoming.map((e) => ({
      id: `e-${e.source}-${e.target}`,
      source: e.source,
      target: e.target,
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: "var(--vscode-panel-border, #444)" },
    }));
  }, []);

  const applyGraph = useCallback(
    (
      incomingNodes: IncomingNode[],
      incomingEdges: IncomingEdge[],
      centerId: string | null,
    ) => {
      const flowNodes = buildFlowNodes(incomingNodes, centerId);
      const flowEdges = buildFlowEdges(incomingEdges);
      const { nodes: layouted, edges: layoutedEdges } = layoutGraph(
        flowNodes,
        flowEdges,
      );
      setNodes(layouted);
      setEdges(layoutedEdges);
      setCurrentNodeId(centerId);
    },
    [buildFlowNodes, buildFlowEdges, setNodes, setEdges],
  );

  // Message handler from extension host
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data;
      if (!msg || !msg.type) return;

      switch (msg.type) {
        case "updateCenter":
          if (!locked) {
            expandedRef.current.clear();
            setEmptyMessage(msg.emptyMessage ?? "No lineage data available.");
            applyGraph(
              msg.nodes ?? [],
              msg.edges ?? [],
              msg.currentNodeId ?? null,
            );
          }
          break;

        case "resetCenter":
          expandedRef.current.clear();
          setEmptyMessage(msg.emptyMessage ?? "No lineage data available.");
          applyGraph(
            msg.nodes ?? [],
            msg.edges ?? [],
            msg.currentNodeId ?? null,
          );
          break;

        case "mergeGraph": {
          const newIncomingNodes: IncomingNode[] = msg.nodes ?? [];
          const newIncomingEdges: IncomingEdge[] = msg.edges ?? [];

          // Track expanded state for button display
          if (msg.expandedNodeId && msg.expandedDirection) {
            const prev = expandedRef.current.get(msg.expandedNodeId) ?? {
              upstream: false,
              downstream: false,
            };
            expandedRef.current.set(msg.expandedNodeId, {
              ...prev,
              [msg.expandedDirection]: true,
            });
          }

          setNodes((prev) => {
            const existingIds = new Set(prev.map((n) => n.id));
            const filteredNew = newIncomingNodes.filter(
              (n) => !existingIds.has(n.id),
            );
            const newFlowNodes = buildFlowNodes(
              filteredNew,
              currentNodeIdRef.current,
            );
            const allNodes = [...prev, ...newFlowNodes];

            const currentEdges = edgesRef.current;
            const existingEdgeIds = new Set(currentEdges.map((e) => e.id));
            const filteredNewEdges = newIncomingEdges.filter(
              (e) => !existingEdgeIds.has(`e-${e.source}-${e.target}`),
            );
            const newFlowEdges = buildFlowEdges(filteredNewEdges);
            const allEdges = [...currentEdges, ...newFlowEdges];

            const { nodes: layouted, edges: layoutedEdges } = layoutGraph(
              allNodes,
              allEdges,
            );
            setEdges(layoutedEdges);
            return layouted;
          });
          break;
        }
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [locked, applyGraph, buildFlowNodes, buildFlowEdges, setNodes, setEdges]);

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

  const onReset = useCallback(() => {
    vscodeApi.postMessage({ type: "resetCenter" });
  }, []);

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
        <label className="lock-label">
          <input
            type="checkbox"
            checked={locked}
            onChange={(e) => setLocked(e.target.checked)}
          />
          Lock view
        </label>
        <button
          className="reset-btn"
          onClick={onReset}
          title="Re-center on current model"
        >
          Reset
        </button>
        <span className="center-label">
          {nodes.find((n) => n.data?.isCurrent)?.data?.name ?? ""}
        </span>
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.1}
        maxZoom={3}
        proOptions={{ hideAttribution: true }}
      >
        <Controls showInteractive={false} />
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
  createRoot(container).render(<App />);
}
