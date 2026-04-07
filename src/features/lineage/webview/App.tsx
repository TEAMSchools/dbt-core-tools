import { useCallback, useEffect, useState, useRef } from "react";
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
import { layoutGraph, layoutExpand } from "./layout";
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
  depth: number;
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
  const [locked, setLocked] = useState(false);
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
  const expandChildrenRef = useRef<
    Map<string, { upstream: Set<string>; downstream: Set<string> }>
  >(new Map());
  // Keep a ref to edges for use inside setNodes callback
  const edgesRef = useRef<Edge[]>([]);
  const currentNodeIdRef = useRef<string | null>(null);
  const { setCenter } = useReactFlow();

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
      style: { stroke: "#555" },
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
        case "highlightCenter": {
          if (locked) break;
          const newCenterId: string | null = msg.currentNodeId ?? null;
          setCurrentNodeId(newCenterId);
          setNodes((prev) => {
            const updated = prev.map((n) => ({
              ...n,
              data: {
                ...n.data,
                isCurrent: n.id === newCenterId,
              } as GraphNodeData,
            }));
            if (newCenterId) {
              const target = updated.find((n) => n.id === newCenterId);
              if (target) {
                const x = target.position.x + 80;
                const y = target.position.y + 32;
                setTimeout(
                  () => setCenter(x, y, { zoom: 1, duration: 300 }),
                  50,
                );
              }
            }
            return updated;
          });
          break;
        }

        case "resetCenter":
          expandedRef.current.clear();
          expandChildrenRef.current.clear();
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

            // Track which new nodes belong to this expansion
            if (msg.expandedNodeId && msg.expandedDirection) {
              const prev2 = expandChildrenRef.current.get(
                msg.expandedNodeId,
              ) ?? {
                upstream: new Set<string>(),
                downstream: new Set<string>(),
              };
              for (const n of filteredNew) {
                if (msg.expandedDirection === "upstream") {
                  prev2.upstream.add(n.id);
                } else {
                  prev2.downstream.add(n.id);
                }
              }
              expandChildrenRef.current.set(msg.expandedNodeId, prev2);
            }

            const newFlowNodes = buildFlowNodes(
              filteredNew,
              currentNodeIdRef.current,
            );

            const currentEdges = edgesRef.current;
            const existingEdgeIds = new Set(currentEdges.map((e) => e.id));
            const filteredNewEdges = newIncomingEdges.filter(
              (e) => !existingEdgeIds.has(`e-${e.source}-${e.target}`),
            );
            const newFlowEdges = buildFlowEdges(filteredNewEdges);
            setEdges([...currentEdges, ...newFlowEdges]);

            const laid = layoutExpand(
              prev,
              newFlowNodes,
              msg.expandedNodeId ?? "",
            );

            // Update the parent node's expanded flag so its button flips to −
            if (msg.expandedNodeId && msg.expandedDirection) {
              const prop =
                msg.expandedDirection === "upstream"
                  ? "expandedUpstream"
                  : "expandedDownstream";
              return laid.map((n) =>
                n.id === msg.expandedNodeId
                  ? {
                      ...n,
                      data: { ...n.data, [prop]: true } as GraphNodeData,
                    }
                  : n,
              );
            }
            return laid;
          });
          break;
        }

        case "collapseDirection": {
          const collapseNodeId: string = msg.nodeId;
          const direction: string = msg.direction;
          if (!collapseNodeId || !direction) break;

          // Recursively collect all nodes to remove (handles grandchildren).
          const idsToRemove = new Set<string>();
          const collectDescendants = (nodeId: string, dir: string) => {
            const t = expandChildrenRef.current.get(nodeId);
            if (!t) return;
            const children = dir === "upstream" ? t.upstream : t.downstream;
            for (const childId of children) {
              idsToRemove.add(childId);
              // Read before deleting so we can recurse into grandchildren
              const childTracked = expandChildrenRef.current.get(childId);
              expandedRef.current.delete(childId);
              expandChildrenRef.current.delete(childId);
              if (childTracked) {
                for (const grandId of childTracked.upstream) {
                  idsToRemove.add(grandId);
                  collectDescendants(grandId, "upstream");
                }
                for (const grandId of childTracked.downstream) {
                  idsToRemove.add(grandId);
                  collectDescendants(grandId, "downstream");
                }
              }
            }
          };
          collectDescendants(collapseNodeId, direction);

          const prevExpanded = expandedRef.current.get(collapseNodeId) ?? {
            upstream: false,
            downstream: false,
          };
          expandedRef.current.set(collapseNodeId, {
            ...prevExpanded,
            [direction]: false,
          });

          const tracked = expandChildrenRef.current.get(collapseNodeId);
          if (tracked) {
            if (direction === "upstream") tracked.upstream.clear();
            else tracked.downstream.clear();
          }

          setNodes((prev) =>
            prev
              .filter((n) => !idsToRemove.has(n.id))
              .map((n) =>
                n.id === collapseNodeId
                  ? {
                      ...n,
                      data: {
                        ...n.data,
                        [direction === "upstream"
                          ? "expandedUpstream"
                          : "expandedDownstream"]: false,
                      } as GraphNodeData,
                    }
                  : n,
              ),
          );
          setEdges((prev) =>
            prev.filter(
              (e) => !idsToRemove.has(e.source) && !idsToRemove.has(e.target),
            ),
          );
          break;
        }
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [
    locked,
    applyGraph,
    buildFlowNodes,
    buildFlowEdges,
    setNodes,
    setEdges,
    setCenter,
  ]);

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
