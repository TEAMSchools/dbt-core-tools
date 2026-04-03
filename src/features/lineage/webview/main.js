// @ts-check
/* global d3, dagre */
(function () {
  const vscode = acquireVsCodeApi();

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  /** @type {{ nodes: GraphNode[], edges: GraphEdge[] } | null} */
  let _graphData = null;
  /** @type {string | null} */
  let _currentNodeId = null;
  /** @type {boolean} */
  let _locked = false;

  /**
   * @typedef {{ id: string, name: string, resourceType: string, materialization: string, contractEnforced: boolean }} GraphNode
   * @typedef {{ source: string, target: string }} GraphEdge
   */

  // ---------------------------------------------------------------------------
  // DOM refs
  // ---------------------------------------------------------------------------

  const svgEl = /** @type {SVGSVGElement} */ (document.getElementById("graph"));
  const contextMenu = /** @type {HTMLElement} */ (
    document.getElementById("context-menu")
  );
  const lockToggle = /** @type {HTMLInputElement} */ (
    document.getElementById("lock-toggle")
  );
  const centerLabel = /** @type {HTMLElement} */ (
    document.getElementById("center-label")
  );

  // ---------------------------------------------------------------------------
  // Lock toggle
  // ---------------------------------------------------------------------------

  lockToggle.addEventListener("change", () => {
    _locked = lockToggle.checked;
  });

  // ---------------------------------------------------------------------------
  // Context menu state
  // ---------------------------------------------------------------------------

  /** @type {string | null} */
  let _contextNodeId = null;

  document.addEventListener("click", () => hideContextMenu());

  contextMenu.querySelectorAll("li[data-action]").forEach((li) => {
    li.addEventListener("click", (e) => {
      e.stopPropagation();
      const action = li.getAttribute("data-action");
      if (!action || !_contextNodeId) return;
      vscode.postMessage({ type: action, nodeId: _contextNodeId });
      hideContextMenu();
    });
  });

  function showContextMenu(x, y, nodeId) {
    _contextNodeId = nodeId;
    contextMenu.style.left = x + "px";
    contextMenu.style.top = y + "px";
    contextMenu.classList.remove("hidden");
  }

  function hideContextMenu() {
    contextMenu.classList.add("hidden");
    _contextNodeId = null;
  }

  // ---------------------------------------------------------------------------
  // Color mapping by resource type
  // ---------------------------------------------------------------------------

  /** @param {string} resourceType */
  function nodeColor(resourceType) {
    switch (resourceType) {
      case "model":
        return "var(--vscode-terminal-ansiBrightBlue, #4fa8d5)";
      case "source":
        return "var(--vscode-terminal-ansiGreen, #4ec9b0)";
      case "test":
        return "var(--vscode-terminal-ansiBrightYellow, #dcdcaa)";
      case "exposure":
        return "var(--vscode-terminal-ansiMagenta, #c586c0)";
      case "seed":
        return "var(--vscode-terminal-ansiYellow, #ce9178)";
      default:
        return "var(--vscode-editorWidget-background, #3c3c3c)";
    }
  }

  /** @param {string} resourceType */
  function nodeFill(resourceType) {
    // Return slightly dimmer background for the rectangle fill
    switch (resourceType) {
      case "model":
        return "var(--vscode-terminal-ansiBlueDim, rgba(79,168,213,0.15))";
      case "source":
        return "rgba(78,201,176,0.15)";
      case "test":
        return "rgba(220,220,170,0.15)";
      case "exposure":
        return "rgba(197,134,192,0.15)";
      case "seed":
        return "rgba(206,145,120,0.15)";
      default:
        return "var(--vscode-editor-background)";
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const NODE_WIDTH = 160;
  const NODE_HEIGHT = 60;

  function render() {
    if (!_graphData || _graphData.nodes.length === 0) {
      d3.select(svgEl).selectAll("*").remove();
      const w = svgEl.clientWidth || 600;
      const h = svgEl.clientHeight || 400;
      d3.select(svgEl)
        .append("text")
        .attr("id", "empty-state")
        .attr("x", w / 2)
        .attr("y", h / 2)
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "middle")
        .attr("fill", "var(--vscode-descriptionForeground)")
        .text("No lineage data available.");
      return;
    }

    const { nodes, edges } = _graphData;

    // Build dagre graph
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: "LR", nodesep: 50, ranksep: 100 });
    g.setDefaultEdgeLabel(() => ({}));

    nodes.forEach((n) => {
      g.setNode(n.id, {
        label: n.name,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      });
    });

    edges.forEach((e) => {
      g.setEdge(e.source, e.target);
    });

    dagre.layout(g);

    // Clear SVG
    d3.select(svgEl).selectAll("*").remove();

    const graphLayout = g.graph();
    const totalW = (graphLayout.width || 600) + 200;
    const totalH = (graphLayout.height || 400) + 100;

    const svg = d3.select(svgEl);

    // Arrowhead marker
    const defs = svg.append("defs");
    defs
      .append("marker")
      .attr("id", "arrow")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 8)
      .attr("refY", 0)
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("class", "edge-arrow");

    // Root group with zoom/pan
    const root = svg.append("g").attr("class", "root");

    // Zoom behavior
    const zoom = d3
      .zoom()
      .scaleExtent([0.1, 3])
      .on("zoom", (event) => {
        root.attr("transform", event.transform);
      });

    svg.call(/** @type {any} */ (zoom));

    // Initial fit-to-view
    const svgW = svgEl.clientWidth || 800;
    const svgH = svgEl.clientHeight || 600;
    const scale = Math.min(svgW / totalW, svgH / totalH, 1);
    const tx = (svgW - totalW * scale) / 2;
    const ty = (svgH - totalH * scale) / 2;
    svg.call(
      /** @type {any} */ (zoom.transform),
      d3.zoomIdentity.translate(tx, ty).scale(scale),
    );

    // Draw edges
    const edgeGroup = root.append("g").attr("class", "edges");
    edges.forEach((e) => {
      const edgeLayout = g.edge(e.source, e.target);
      if (!edgeLayout) return;
      const line = d3
        .line()
        .x((d) => d[0])
        .y((d) => d[1])
        .curve(d3.curveBasis);

      const points = edgeLayout.points.map((p) => [p.x, p.y]);

      edgeGroup
        .append("g")
        .attr("class", "edge")
        .append("path")
        .attr("d", line(/** @type {any} */ (points)))
        .attr("marker-end", "url(#arrow)");
    });

    // Draw nodes
    const nodeGroup = root.append("g").attr("class", "nodes");

    nodes.forEach((n) => {
      const layout = g.node(n.id);
      if (!layout) return;

      const isCurrent = n.id === _currentNodeId;
      const isContracted = n.contractEnforced;

      const g2 = nodeGroup
        .append("g")
        .attr(
          "class",
          "node" +
            (isCurrent ? " current" : "") +
            (isContracted ? " contracted" : ""),
        )
        .attr(
          "transform",
          `translate(${layout.x - NODE_WIDTH / 2}, ${layout.y - NODE_HEIGHT / 2})`,
        )
        .style("cursor", "pointer");

      // Background rect
      g2.append("rect")
        .attr("width", NODE_WIDTH)
        .attr("height", NODE_HEIGHT)
        .attr("fill", nodeFill(n.resourceType))
        .attr("stroke", nodeColor(n.resourceType))
        .attr("rx", 4)
        .attr("ry", 4);

      // Name label (center)
      const maxNameLen = 18;
      const displayName =
        n.name.length > maxNameLen
          ? n.name.slice(0, maxNameLen - 1) + "…"
          : n.name;
      g2.append("text")
        .attr("class", "node-label")
        .attr("x", NODE_WIDTH / 2)
        .attr("y", NODE_HEIGHT / 2 - (n.materialization ? 8 : 0))
        .text(displayName);

      // Materialization label (below name)
      if (n.materialization) {
        g2.append("text")
          .attr("class", "node-label-mat")
          .attr("x", NODE_WIDTH / 2)
          .attr("y", NODE_HEIGHT / 2 + 10)
          .text(n.materialization);
      }

      // Contract badge (shield emoji, top-right)
      if (n.contractEnforced) {
        g2.append("text")
          .attr("class", "node-badge")
          .attr("x", NODE_WIDTH - 8)
          .attr("y", 12)
          .text("🛡");
      }

      // Click → open file
      g2.on("click", (event) => {
        event.stopPropagation();
        hideContextMenu();
        vscode.postMessage({ type: "openFile", nodeId: n.id });
      });

      // Right-click → context menu
      g2.on("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        showContextMenu(event.clientX, event.clientY, n.id);
      });

      // Expand downstream handle (right edge, triangle pointing right)
      const downstreamHandle = nodeGroup
        .append("g")
        .attr("class", "expand-handle")
        .attr(
          "transform",
          `translate(${layout.x + NODE_WIDTH / 2 + 2}, ${layout.y})`,
        );

      downstreamHandle.append("polygon").attr("points", "0,-8 14,0 0,8");

      downstreamHandle.on("click", (event) => {
        event.stopPropagation();
        hideContextMenu();
        vscode.postMessage({
          type: "expand",
          nodeId: n.id,
          direction: "downstream",
        });
      });

      // Expand upstream handle (left edge, triangle pointing left)
      const upstreamHandle = nodeGroup
        .append("g")
        .attr("class", "expand-handle")
        .attr(
          "transform",
          `translate(${layout.x - NODE_WIDTH / 2 - 2}, ${layout.y})`,
        );

      upstreamHandle.append("polygon").attr("points", "0,-8 -14,0 0,8");

      upstreamHandle.on("click", (event) => {
        event.stopPropagation();
        hideContextMenu();
        vscode.postMessage({
          type: "expand",
          nodeId: n.id,
          direction: "upstream",
        });
      });
    });

    // Update center label
    const centerNode = nodes.find((n) => n.id === _currentNodeId);
    centerLabel.textContent = centerNode ? centerNode.name : "";
  }

  // ---------------------------------------------------------------------------
  // Message handler
  // ---------------------------------------------------------------------------

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (!message || !message.type) return;

    switch (message.type) {
      case "setGraph":
        _graphData = { nodes: message.nodes ?? [], edges: message.edges ?? [] };
        _currentNodeId = message.currentNodeId ?? null;
        render();
        break;

      case "updateCenter":
        if (!_locked) {
          _graphData = {
            nodes: message.nodes ?? [],
            edges: message.edges ?? [],
          };
          _currentNodeId = message.currentNodeId ?? null;
          render();
        }
        break;
    }
  });
})();
