import { memo, useCallback } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import type { GraphNodeData } from "./types";

// 4 color groups
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

  const onExpand = useCallback(
    (e: React.MouseEvent, direction: "upstream" | "downstream") => {
      e.stopPropagation();
      const vscode = (window as any).vscodeApi;
      if (!vscode) return;

      const isExpanded =
        direction === "upstream"
          ? data.expandedUpstream
          : data.expandedDownstream;

      vscode.postMessage({
        type: isExpanded ? "collapseDirection" : "expand",
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

      {data.hasUpstream && (
        <button
          className="expand-btn expand-btn-left"
          onClick={(e) => onExpand(e, "upstream")}
          title={
            data.expandedUpstream ? "Collapse upstream" : "Expand upstream"
          }
        >
          {data.expandedUpstream ? "\u2212" : "+"}
        </button>
      )}

      {data.hasDownstream && (
        <button
          className="expand-btn expand-btn-right"
          onClick={(e) => onExpand(e, "downstream")}
          title={
            data.expandedDownstream
              ? "Collapse downstream"
              : "Expand downstream"
          }
        >
          {data.expandedDownstream ? "\u2212" : "+"}
        </button>
      )}

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
