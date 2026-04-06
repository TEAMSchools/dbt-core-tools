// @ts-nocheck — webview script runs in browser context, not TS-checked
/* global d3, ELK */
(function () {
  const vscode = acquireVsCodeApi();

  // State
  let _graphData = null;
  let _currentNodeId = null;
  let _locked = false;
  let _emptyMessage = "No lineage data available.";

  // DOM refs
  const svgEl = document.getElementById("graph");
  const contextMenu = document.getElementById("context-menu");
  const lockToggle = document.getElementById("lock-toggle");
  const centerLabel = document.getElementById("center-label");

  // Lock toggle
  lockToggle.addEventListener("change", () => {
    _locked = lockToggle.checked;
  });

  // Context menu state
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

  // Color mapping by resource type
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

  function nodeFill(resourceType) {
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

  // ELK instance
  const elk = new ELK();

  const NODE_WIDTH = 160;
  const NODE_HEIGHT = 60;

  async function render() {
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
        .text(_emptyMessage);
      return;
    }

    const { nodes, edges } = _graphData;

    // Build ELK graph
    const elkGraph = {
      id: "root",
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": "RIGHT",
        "elk.layered.spacing.nodeNodeBetweenLayers": "80",
        "elk.spacing.nodeNode": "25",
        "elk.layered.compaction.postCompaction.strategy": "EDGE_LENGTH",
        "elk.edgeRouting": "ORTHOGONAL",
      },
      children: nodes.map((n) => ({
        id: n.id,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      })),
      edges: edges.map((e, i) => ({
        id: "e" + i,
        sources: [e.source],
        targets: [e.target],
      })),
    };

    let layout;
    try {
      layout = await elk.layout(elkGraph);
    } catch (err) {
      console.error("ELK layout failed:", err);
      return;
    }

    // Clear SVG
    d3.select(svgEl).selectAll("*").remove();

    const childMap = new Map();
    for (const child of layout.children || []) {
      childMap.set(child.id, child);
    }

    const totalW = (layout.width || 600) + 100;
    const totalH = (layout.height || 400) + 100;

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

    const zoom = d3
      .zoom()
      .scaleExtent([0.1, 3])
      .on("zoom", (event) => {
        root.attr("transform", event.transform);
      });

    svg.call(zoom);

    // Initial fit-to-view
    const svgW = svgEl.clientWidth || 800;
    const svgH = svgEl.clientHeight || 600;
    const scale = Math.min(svgW / totalW, svgH / totalH, 1);
    const tx = (svgW - totalW * scale) / 2;
    const ty = (svgH - totalH * scale) / 2;
    svg.call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));

    // Draw edges
    const edgeGroup = root.append("g").attr("class", "edges");
    for (const elkEdge of layout.edges || []) {
      for (const section of elkEdge.sections || []) {
        const points = [];
        points.push([section.startPoint.x, section.startPoint.y]);
        for (const bp of section.bendPoints || []) {
          points.push([bp.x, bp.y]);
        }
        points.push([section.endPoint.x, section.endPoint.y]);

        const line = d3
          .line()
          .x((d) => d[0])
          .y((d) => d[1]);

        edgeGroup
          .append("g")
          .attr("class", "edge")
          .append("path")
          .attr("d", line(points))
          .attr("marker-end", "url(#arrow)");
      }
    }

    // Draw nodes
    const nodeGroup = root.append("g").attr("class", "nodes");

    nodes.forEach((n) => {
      const elkNode = childMap.get(n.id);
      if (!elkNode) return;

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
        .attr("transform", `translate(${elkNode.x}, ${elkNode.y})`)
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
          ? n.name.slice(0, maxNameLen - 1) + "\u2026"
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
          .text("\uD83D\uDEE1");
      }

      // Test count badge (bottom-left)
      if (n.testCount > 0) {
        const badgeG = g2
          .append("g")
          .attr("class", "test-badge")
          .attr("transform", `translate(18, ${NODE_HEIGHT - 8})`);

        badgeG
          .append("circle")
          .attr("r", 9)
          .attr("fill", "var(--vscode-terminal-ansiBrightYellow, #dcdcaa)")
          .attr("opacity", 0.25);

        badgeG
          .append("text")
          .attr("text-anchor", "middle")
          .attr("dominant-baseline", "central")
          .attr("font-size", "9px")
          .attr("fill", "var(--vscode-terminal-ansiBrightYellow, #dcdcaa)")
          .text(n.testCount);
      }

      // Click -> open file
      g2.on("click", (event) => {
        event.stopPropagation();
        hideContextMenu();
        vscode.postMessage({ type: "openFile", nodeId: n.id });
      });

      // Right-click -> context menu
      g2.on("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        showContextMenu(event.clientX, event.clientY, n.id);
      });

      // Expand downstream handle (right edge, circular + button)
      const downstreamHandle = nodeGroup
        .append("g")
        .attr("class", "expand-handle")
        .attr(
          "transform",
          `translate(${elkNode.x + NODE_WIDTH + 12}, ${elkNode.y + NODE_HEIGHT / 2})`,
        );

      downstreamHandle
        .append("circle")
        .attr("r", 10)
        .attr("class", "expand-circle");
      downstreamHandle
        .append("text")
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "central")
        .attr("font-size", "14px")
        .attr("class", "expand-glyph")
        .text("+");

      downstreamHandle.on("click", (event) => {
        event.stopPropagation();
        hideContextMenu();
        vscode.postMessage({
          type: "expand",
          nodeId: n.id,
          direction: "downstream",
        });
      });

      // Expand upstream handle (left edge, circular + button)
      const upstreamHandle = nodeGroup
        .append("g")
        .attr("class", "expand-handle")
        .attr(
          "transform",
          `translate(${elkNode.x - 12}, ${elkNode.y + NODE_HEIGHT / 2})`,
        );

      upstreamHandle
        .append("circle")
        .attr("r", 10)
        .attr("class", "expand-circle");
      upstreamHandle
        .append("text")
        .attr("text-anchor", "middle")
        .attr("dominant-baseline", "central")
        .attr("font-size", "14px")
        .attr("class", "expand-glyph")
        .text("+");

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

  // Message handler
  window.addEventListener("message", (event) => {
    const message = event.data;
    if (!message || !message.type) return;

    switch (message.type) {
      case "setGraph":
        _emptyMessage = message.emptyMessage ?? "No lineage data available.";
        _graphData = { nodes: message.nodes ?? [], edges: message.edges ?? [] };
        _currentNodeId = message.currentNodeId ?? null;
        void render();
        break;

      case "updateCenter":
        if (!_locked) {
          _emptyMessage = message.emptyMessage ?? "No lineage data available.";
          _graphData = {
            nodes: message.nodes ?? [],
            edges: message.edges ?? [],
          };
          _currentNodeId = message.currentNodeId ?? null;
          void render();
        }
        break;

      case "mergeGraph": {
        if (!_graphData) {
          _graphData = {
            nodes: message.nodes ?? [],
            edges: message.edges ?? [],
          };
        } else {
          const existingIds = new Set(_graphData.nodes.map((n) => n.id));
          for (const node of message.nodes ?? []) {
            if (!existingIds.has(node.id)) {
              _graphData.nodes.push(node);
              existingIds.add(node.id);
            }
          }

          const existingEdges = new Set(
            _graphData.edges.map((e) => e.source + "\u2192" + e.target),
          );
          for (const edge of message.edges ?? []) {
            const key = edge.source + "\u2192" + edge.target;
            if (!existingEdges.has(key)) {
              _graphData.edges.push(edge);
              existingEdges.add(key);
            }
          }
        }
        void render();
        break;
      }
    }
  });

  // Signal ready
  vscode.postMessage({ type: "ready" });
})();
