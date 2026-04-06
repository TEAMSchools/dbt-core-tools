import { memo, useCallback } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import type { GraphNodeData } from "./types";

const COLOR_MAP: Record<string, string> = {
  model: "#5fb3e0",
  source: "#5bd4be",
  test: "#e6e6a8",
  exposure: "#d494d0",
  seed: "#d9a488",
};

const FILL_MAP: Record<string, string> = {
  model: "rgba(95,179,224,0.15)",
  source: "rgba(91,212,190,0.15)",
  test: "rgba(230,230,168,0.15)",
  exposure: "rgba(212,148,208,0.15)",
  seed: "rgba(217,164,136,0.15)",
};

function DbtNode({ data }: NodeProps<Node<GraphNodeData>>) {
  const color = COLOR_MAP[data.resourceType] ?? "#6e6e6e";
  const fill = FILL_MAP[data.resourceType] ?? "rgba(110,110,110,0.15)";

  const onExpand = useCallback(
    (e: React.MouseEvent, direction: "upstream" | "downstream") => {
      e.stopPropagation();
      const vscode = (window as any).vscodeApi;
      if (!vscode) return;

      const isExpanded =
        direction === "upstream" ? data.expandedUpstream : data.expandedDownstream;

      vscode.postMessage({
        type: isExpanded ? "collapse" : "expand",
        nodeId: data.id,
        direction,
      });
    },
    [data.id, data.expandedUpstream, data.expandedDownstream],
  );

  const onClick = useCallback(() => {
    const vscode = (window as any).vscodeApi;
    if (!vscode) return;
    vscode.postMessage({ type: "openFile", nodeId: data.id });
  }, [data.id]);

  const onContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      // Dispatch custom event for App.tsx to handle
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

  return (
    <div
      className={`dbt-node${data.isCurrent ? " current" : ""}${data.contractEnforced ? " contracted" : ""}`}
      style={{
        background: fill,
        borderColor: data.isCurrent ? "var(--vscode-focusBorder, #007acc)" : color,
        borderWidth: data.isCurrent ? "2.5px" : "1.5px",
        borderStyle: data.contractEnforced ? "dashed" : "solid",
        borderRadius: 4,
        padding: "8px 12px",
        minWidth: 160,
        cursor: "pointer",
      }}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      <Handle type="target" position={Position.Left} style={{ visibility: "hidden" }} />
      <Handle type="source" position={Position.Right} style={{ visibility: "hidden" }} />

      {data.hasUpstream && (
        <button
          className="expand-btn expand-btn-left"
          onClick={(e) => onExpand(e, "upstream")}
          title={data.expandedUpstream ? "Collapse upstream" : "Expand upstream"}
        >
          {data.expandedUpstream ? "\u2212" : "+"}
        </button>
      )}

      {data.hasDownstream && (
        <button
          className="expand-btn expand-btn-right"
          onClick={(e) => onExpand(e, "downstream")}
          title={data.expandedDownstream ? "Collapse downstream" : "Expand downstream"}
        >
          {data.expandedDownstream ? "\u2212" : "+"}
        </button>
      )}

      <div className="node-name">{displayName}</div>
      {data.materialization && (
        <div className="node-mat">{data.materialization}</div>
      )}

      {data.contractEnforced && (
        <span className="node-badge" title="Contract enforced">{"\uD83D\uDEE1"}</span>
      )}
      {data.testCount > 0 && (
        <span className="test-badge" title={`${data.testCount} tests`}>
          {data.testCount}
        </span>
      )}
    </div>
  );
}

export default memo(DbtNode);
