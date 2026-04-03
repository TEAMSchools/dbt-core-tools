/**
 * Lineage Viewer Panel for dbt Core Tools.
 *
 * Renders a DAG of upstream/downstream dependencies for the active model
 * using D3.js and dagre in a webview panel.
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { getActiveProject } from "../../extension";
import { DbtProject } from "../../core/project";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GraphNode {
  id: string;
  name: string;
  resourceType: string;
  materialization: string;
  contractEnforced: boolean;
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
// Panel cache — one lineage panel shared across models
// ---------------------------------------------------------------------------

let _panel: vscode.WebviewPanel | undefined;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Shows (or reveals) the lineage panel for the currently active SQL file.
 */
export async function showLineage(
  context: vscode.ExtensionContext
): Promise<void> {
  const project = getActiveProject();
  if (!project) {
    vscode.window.showWarningMessage(
      "dbt Core Tools: No active dbt project. Open a file inside a dbt project first."
    );
    return;
  }

  await project.ensureLoaded();

  const nodeId = getActiveNodeId(project);
  if (!nodeId) {
    vscode.window.showWarningMessage(
      "dbt Core Tools: Could not find a dbt model for the current file."
    );
    return;
  }

  if (_panel) {
    _panel.reveal(vscode.ViewColumn.Two);
  } else {
    _panel = vscode.window.createWebviewPanel(
      "dbtCoreTools.lineage",
      "dbt Lineage",
      vscode.ViewColumn.Two,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, "src", "features", "lineage", "webview"),
        ],
      }
    );

    _panel.onDidDispose(() => {
      _panel = undefined;
    });

    _panel.webview.onDidReceiveMessage(async (message) => {
      await handleWebviewMessage(message, context);
    });

    _panel.webview.html = buildWebviewHtml(context, _panel.webview);
  }

  const graphData = buildGraphData(project, nodeId, 1);
  _panel.webview.postMessage({
    type: "setGraph",
    nodes: graphData.nodes,
    edges: graphData.edges,
    currentNodeId: nodeId,
  });
}

/**
 * Called when the active text editor changes.
 * If the panel is open and not locked, updates it to center on the new model.
 */
export async function updateLineageCenter(
  context: vscode.ExtensionContext
): Promise<void> {
  if (!_panel) {
    return;
  }

  const project = getActiveProject();
  if (!project) {
    return;
  }

  await project.ensureLoaded();

  const nodeId = getActiveNodeId(project);
  if (!nodeId) {
    return;
  }

  const graphData = buildGraphData(project, nodeId, 1);
  _panel.webview.postMessage({
    type: "updateCenter",
    nodes: graphData.nodes,
    edges: graphData.edges,
    currentNodeId: nodeId,
  });
}

// ---------------------------------------------------------------------------
// Graph building
// ---------------------------------------------------------------------------

/**
 * Builds a subgraph centered on `centerId` walking up/downstream `depth` levels.
 */
export function buildGraphData(
  project: DbtProject,
  centerId: string,
  depth: number
): GraphData {
  const childMap = project.getChildMap();
  const parentMap = project.getParentMap();
  const nodes = project.getNodes();
  const sources = project.getSources();

  const visitedNodes = new Set<string>();
  const edges: GraphEdge[] = [];

  function expandUpstream(id: string, remainingDepth: number): void {
    if (remainingDepth <= 0) return;
    const parents = parentMap[id] ?? [];
    for (const parentId of parents) {
      if (!visitedNodes.has(parentId)) {
        visitedNodes.add(parentId);
        expandUpstream(parentId, remainingDepth - 1);
      }
      edges.push({ source: parentId, target: id });
    }
  }

  function expandDownstream(id: string, remainingDepth: number): void {
    if (remainingDepth <= 0) return;
    const children = childMap[id] ?? [];
    for (const childId of children) {
      if (!visitedNodes.has(childId)) {
        visitedNodes.add(childId);
        expandDownstream(childId, remainingDepth - 1);
      }
      edges.push({ source: id, target: childId });
    }
  }

  // Start from center
  visitedNodes.add(centerId);
  expandUpstream(centerId, depth);
  expandDownstream(centerId, depth);

  // De-duplicate edges
  const edgeSet = new Set<string>();
  const uniqueEdges: GraphEdge[] = [];
  for (const edge of edges) {
    const key = `${edge.source}→${edge.target}`;
    if (!edgeSet.has(key)) {
      edgeSet.add(key);
      uniqueEdges.push(edge);
    }
  }

  // Build GraphNode list
  const graphNodes: GraphNode[] = [];
  for (const id of visitedNodes) {
    const node = nodes[id];
    if (node) {
      graphNodes.push({
        id: node.unique_id,
        name: node.name,
        resourceType: node.resource_type,
        materialization: (node.config?.["materialized"] as string | undefined) ?? "",
        contractEnforced: node.contract?.enforced ?? false,
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
      });
      continue;
    }

    // Unknown node type (e.g. test, exposure referenced in maps)
    // Parse resource type from the ID prefix: "test.project.name" → "test"
    const resourceType = id.split(".")[0] ?? "unknown";
    const fallbackName = id.split(".").slice(2).join(".") || id;
    graphNodes.push({
      id,
      name: fallbackName,
      resourceType,
      materialization: "",
      contractEnforced: false,
    });
  }

  return { nodes: graphNodes, edges: uniqueEdges };
}

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------

async function handleWebviewMessage(
  message: { type: string; nodeId?: string; direction?: string },
  context: vscode.ExtensionContext
): Promise<void> {
  if (!message || !message.type) return;

  const { type, nodeId } = message;

  switch (type) {
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
      _panel?.webview.postMessage({
        type: "setGraph",
        nodes: graphData.nodes,
        edges: graphData.edges,
        currentNodeId: nodeId,
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the unique_id for the node corresponding to the currently active editor.
 */
function getActiveNodeId(project: DbtProject): string | null {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return null;

  const filePath = editor.document.uri.fsPath;
  const node = project.findNodeByFilePath(filePath);
  return node?.unique_id ?? null;
}

/**
 * Resolves a node's unique_id to an absolute file path on disk.
 */
function resolveNodeFilePath(nodeId: string): string | null {
  const project = getActiveProject();
  if (!project) return null;

  const nodes = project.getNodes();
  const sources = project.getSources();

  const node = nodes[nodeId];
  if (node) {
    const abs = path.isAbsolute(node.original_file_path)
      ? node.original_file_path
      : path.join(project.rootPath, node.original_file_path);
    return fs.existsSync(abs) ? abs : null;
  }

  const source = sources[nodeId];
  if (source) {
    const abs = path.isAbsolute(source.original_file_path)
      ? source.original_file_path
      : path.join(project.rootPath, source.original_file_path);
    return fs.existsSync(abs) ? abs : null;
  }

  return null;
}

// ---------------------------------------------------------------------------
// HTML builder
// ---------------------------------------------------------------------------

function buildWebviewHtml(
  context: vscode.ExtensionContext,
  webview: vscode.Webview
): string {
  const webviewDir = vscode.Uri.joinPath(
    context.extensionUri,
    "src",
    "features",
    "lineage",
    "webview"
  );

  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewDir, "styles.css"));
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewDir, "main.js"));
  const cspSource = webview.cspSource;

  const htmlPath = path.join(
    context.extensionPath,
    "src",
    "features",
    "lineage",
    "webview",
    "index.html"
  );

  let html = fs.readFileSync(htmlPath, "utf8");
  html = html
    .replace(/\{\{styleUri\}\}/g, styleUri.toString())
    .replace(/\{\{scriptUri\}\}/g, scriptUri.toString())
    .replace(/\{\{cspSource\}\}/g, cspSource);

  return html;
}
