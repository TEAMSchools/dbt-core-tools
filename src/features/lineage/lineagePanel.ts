/**
 * Lineage Viewer — persistent bottom panel using WebviewViewProvider.
 *
 * Renders a DAG of upstream/downstream dependencies for the active model
 * using D3.js and ELK in a webview view (Panel area).
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { getActiveProject } from "../../extension";
import { DbtProject } from "../../core/project";
import { safeJoinPath } from "../../utils/paths";

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
  hasUpstream: boolean;
  hasDownstream: boolean;
  depth: number;
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

    // Send initial graph data for whatever file is currently open.
    // Use resetCenter (bypasses lock) since this is the initial load.
    this._sendResetCenter();
  }

  /**
   * Highlights the node for the active editor without rebuilding the graph.
   * Called on editor focus change. Sends empty state when no dbt model is active.
   */
  async updateCenter(): Promise<void> {
    if (!this._view) {
      return;
    }

    const project = getActiveProject();
    if (!project) {
      this._postMessage({
        type: "resetCenter",
        nodes: [],
        edges: [],
        currentNodeId: null,
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
        emptyMessage: "No dbt model found for this file",
      });
      return;
    }

    this._postMessage({
      type: "highlightCenter",
      currentNodeId: nodeId,
    });
  }

  /**
   * Rebuilds the lineage graph with fresh manifest data.
   * Called on manifest reload — not on editor focus change.
   */
  async refreshGraph(): Promise<void> {
    await this._sendResetCenter();
  }

  /**
   * Sends a resetCenter message (bypasses lock toggle) for the currently active node.
   */
  private async _sendResetCenter(): Promise<void> {
    if (!this._view) return;

    const project = getActiveProject();
    if (!project) {
      this._postMessage({
        type: "resetCenter",
        nodes: [],
        edges: [],
        currentNodeId: null,
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
        emptyMessage: "No dbt model found for this file",
      });
      return;
    }

    const graphData = buildGraphData(project, nodeId, 1);
    this._postMessage({
      type: "resetCenter",
      nodes: graphData.nodes,
      edges: graphData.edges,
      currentNodeId: nodeId,
    });
  }

  private _postMessage(message: unknown): void {
    if (!this._view) {
      return;
    }
    if (!this._ready) {
      // Don't let a highlight-only message overwrite a pending graph message.
      const msg = message as { type?: string };
      if (msg.type === "highlightCenter" && this._pendingMessage) {
        return;
      }
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
    direction?: string;
  }): Promise<void> {
    if (!message || !message.type) return;
    const { type, nodeId } = message;

    switch (type) {
      case "resetCenter": {
        await this._sendResetCenter();
        break;
      }
      case "openFile": {
        if (!nodeId) return;
        const filePath = resolveNodeFilePath(nodeId);
        if (filePath) {
          const doc = await vscode.workspace.openTextDocument(filePath);
          await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
        }
        break;
      }
      case "expand": {
        if (!nodeId) return;
        const project = getActiveProject();
        if (!project) return;
        await project.ensureLoaded();
        const graphData = buildGraphData(project, nodeId, 1);
        this._postMessage({
          type: "mergeGraph",
          nodes: graphData.nodes,
          edges: graphData.edges,
          expandedNodeId: nodeId,
          expandedDirection: message.direction,
        });
        break;
      }
      case "collapseDirection": {
        if (!nodeId || !message.direction) return;
        this._postMessage({
          type: "collapseDirection",
          nodeId,
          direction: message.direction,
        });
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
  depth: number,
): GraphData {
  const childMap = project.getChildMap();
  const parentMap = project.getParentMap();
  const nodes = project.getNodes();
  const sources = project.getSources();

  // Build supplementary child entries for sources that may not appear in
  // child_map. If model X lists source S in its parent_map, then S→X is
  // a downstream relationship.
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
  const nodeDepths = new Map<string, number>();
  const edges: GraphEdge[] = [];

  function isTest(id: string): boolean {
    return id.startsWith("test.");
  }

  function expandUpstream(id: string, remainingDepth: number, depth: number): void {
    if (remainingDepth <= 0) return;
    const parents = parentMap[id] ?? [];
    for (const parentId of parents) {
      if (isTest(parentId)) continue;
      if (!visitedNodes.has(parentId)) {
        visitedNodes.add(parentId);
        nodeDepths.set(parentId, depth - 1);
        expandUpstream(parentId, remainingDepth - 1, depth - 1);
      }
      edges.push({ source: parentId, target: id });
    }
  }

  function expandDownstream(id: string, remainingDepth: number, depth: number): void {
    if (remainingDepth <= 0) return;
    const children = supplementedChildMap[id] ?? [];
    for (const childId of children) {
      if (isTest(childId)) continue;
      if (!visitedNodes.has(childId)) {
        visitedNodes.add(childId);
        nodeDepths.set(childId, depth + 1);
        expandDownstream(childId, remainingDepth - 1, depth + 1);
      }
      edges.push({ source: id, target: childId });
    }
  }

  visitedNodes.add(centerId);
  nodeDepths.set(centerId, 0);
  expandUpstream(centerId, depth, 0);
  expandDownstream(centerId, depth, 0);

  const edgeSet = new Set<string>();
  const uniqueEdges: GraphEdge[] = [];
  for (const edge of edges) {
    const key = `${edge.source}\u2192${edge.target}`;
    if (!edgeSet.has(key)) {
      edgeSet.add(key);
      uniqueEdges.push(edge);
    }
  }

  // Count test children for each visited node.
  const testCounts = new Map<string, number>();
  for (const id of visitedNodes) {
    const children = supplementedChildMap[id] ?? [];
    const count = children.filter((c) => isTest(c)).length;
    if (count > 0) {
      testCounts.set(id, count);
    }
  }

  const graphNodes: GraphNode[] = [];
  for (const id of visitedNodes) {
    const tc = testCounts.get(id) ?? 0;
    const node = nodes[id];
    if (node) {
      const parents = (parentMap[id] ?? []).filter((p) => !isTest(p));
      const children = (supplementedChildMap[id] ?? []).filter(
        (c) => !isTest(c),
      );
      graphNodes.push({
        id: node.unique_id,
        name: node.name,
        resourceType: node.resource_type,
        materialization:
          (node.config?.["materialized"] as string | undefined) ?? "",
        contractEnforced: node.contract?.enforced ?? false,
        testCount: tc,
        hasUpstream: parents.length > 0,
        hasDownstream: children.length > 0,
        depth: nodeDepths.get(id) ?? 0,
      });
      continue;
    }
    const source = sources[id];
    if (source) {
      const parents = (parentMap[id] ?? []).filter((p) => !isTest(p));
      const children = (supplementedChildMap[id] ?? []).filter(
        (c) => !isTest(c),
      );
      graphNodes.push({
        id: source.unique_id,
        name: source.name,
        resourceType: source.resource_type,
        materialization: "",
        contractEnforced: false,
        testCount: tc,
        hasUpstream: parents.length > 0,
        hasDownstream: children.length > 0,
        depth: nodeDepths.get(id) ?? 0,
      });
      continue;
    }
    const resourceType = id.split(".")[0] ?? "unknown";
    const fallbackName = id.split(".").slice(2).join(".") || id;
    const parents = (parentMap[id] ?? []).filter((p) => !isTest(p));
    const children = (supplementedChildMap[id] ?? []).filter((c) => !isTest(c));
    graphNodes.push({
      id,
      name: fallbackName,
      resourceType,
      materialization: "",
      contractEnforced: false,
      testCount: tc,
      hasUpstream: parents.length > 0,
      hasDownstream: children.length > 0,
      depth: nodeDepths.get(id) ?? 0,
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
