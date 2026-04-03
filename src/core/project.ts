/**
 * DbtProject represents a single dbt project in the workspace.
 * Handles manifest loading, caching, watching, and typed accessors.
 */

import * as fs from "fs";
import * as path from "path";
import { safeJoinPath } from "../utils/paths";

// ---------------------------------------------------------------------------
// Manifest type definitions
// ---------------------------------------------------------------------------

export interface ManifestColumn {
  name: string;
  description?: string;
  data_type?: string;
  meta?: Record<string, unknown>;
  constraints?: unknown[];
  tags?: string[];
}

export interface ManifestNode {
  unique_id: string;
  resource_type: string;
  name: string;
  path: string;
  original_file_path: string;
  patch_path?: string | null;
  compiled_code?: string;
  depends_on: {
    macros: string[];
    nodes: string[];
  };
  columns: Record<string, ManifestColumn>;
  contract?: {
    enforced: boolean;
  };
  config?: Record<string, unknown>;
}

export interface ManifestSource {
  unique_id: string;
  resource_type: string;
  source_name: string;
  name: string;
  identifier: string;
  path: string;
  original_file_path: string;
  columns: Record<string, ManifestColumn>;
}

export interface ManifestMacro {
  unique_id: string;
  name: string;
  package_name: string;
  path: string;
  original_file_path: string;
  macro_sql: string;
}

export interface ManifestData {
  nodes: Record<string, ManifestNode>;
  sources: Record<string, ManifestSource>;
  macros: Record<string, ManifestMacro>;
  child_map?: Record<string, string[]>;
  parent_map?: Record<string, string[]>;
}

// ---------------------------------------------------------------------------
// Event emitter (minimal, no vscode dependency)
// ---------------------------------------------------------------------------

type Listener<T> = (value: T) => void;

class EventEmitter<T> {
  private listeners: Listener<T>[] = [];

  fire(value: T): void {
    for (const l of this.listeners) {
      l(value);
    }
  }

  event(listener: Listener<T>): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  dispose(): void {
    this.listeners = [];
  }
}

// ---------------------------------------------------------------------------
// DbtProject
// ---------------------------------------------------------------------------

export class DbtProject {
  readonly projectYmlPath: string;
  readonly rootPath: string;
  readonly manifestPath: string;
  readonly name: string;

  private manifest: ManifestData | null = null;
  private _loadPromise: Promise<void> | null = null;
  private _watcher: fs.FSWatcher | null = null;
  private _onManifestChanged = new EventEmitter<DbtProject>();

  /** Subscribe to manifest reload events. Returns a disposer. */
  readonly onManifestChanged = (listener: Listener<DbtProject>) =>
    this._onManifestChanged.event(listener);

  constructor(projectYmlPath: string, opts: { name: string }) {
    this.projectYmlPath = projectYmlPath;
    this.rootPath = path.dirname(projectYmlPath);
    this.manifestPath = path.join(this.rootPath, "target", "manifest.json");
    this.name = opts.name;
  }

  /**
   * Lazy-loads the manifest and starts watching for changes.
   * Safe to call multiple times — concurrent calls share the same promise.
   */
  async ensureLoaded(): Promise<void> {
    if (!this._loadPromise) {
      this._loadPromise = this._load();
    }
    return this._loadPromise;
  }

  private async _load(): Promise<void> {
    await this.reloadManifest();
    this._startWatcher();
  }

  /** Reads and parses manifest.json, fires onManifestChanged. */
  async reloadManifest(): Promise<void> {
    try {
      const raw = await fs.promises.readFile(this.manifestPath, "utf8");
      this.manifest = JSON.parse(raw) as ManifestData;
      this._onManifestChanged.fire(this);
      // If target/ was created after initial load, start watching now.
      this._startWatcher();
    } catch {
      // Manifest may not exist yet (before first dbt parse); leave as null.
      this.manifest = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Typed accessors
  // ---------------------------------------------------------------------------

  getNodes(): Record<string, ManifestNode> {
    return this.manifest?.nodes ?? {};
  }

  getSources(): Record<string, ManifestSource> {
    return this.manifest?.sources ?? {};
  }

  getMacros(): Record<string, ManifestMacro> {
    return this.manifest?.macros ?? {};
  }

  getChildMap(): Record<string, string[]> {
    return this.manifest?.child_map ?? {};
  }

  getParentMap(): Record<string, string[]> {
    return this.manifest?.parent_map ?? {};
  }

  // ---------------------------------------------------------------------------
  // Search helpers
  // ---------------------------------------------------------------------------

  /** Returns the first node whose `name` matches `modelName`. */
  findNodeByName(modelName: string): ManifestNode | null {
    const nodes = this.getNodes();
    for (const node of Object.values(nodes)) {
      if (node.name === modelName) {
        return node;
      }
    }
    return null;
  }

  /**
   * Returns the first node whose `original_file_path` resolves to `filePath`.
   * Accepts both absolute paths and project-relative paths.
   */
  findNodeByFilePath(filePath: string): ManifestNode | null {
    const nodes = this.getNodes();
    for (const node of Object.values(nodes)) {
      const abs = path.isAbsolute(node.original_file_path)
        ? node.original_file_path
        : safeJoinPath(this.rootPath, node.original_file_path);
      if (!abs) {
        continue;
      }
      if (abs === filePath || node.original_file_path === filePath) {
        return node;
      }
    }
    return null;
  }

  /** Returns true when `filePath` lives inside this project's root directory. */
  containsFile(filePath: string): boolean {
    const rel = path.relative(this.rootPath, filePath);
    // path.relative returns a path starting with ".." when outside
    return !rel.startsWith("..") && !path.isAbsolute(rel);
  }

  /** Returns the mtime of manifest.json, or null if it doesn't exist. */
  async getManifestMtime(): Promise<Date | null> {
    try {
      const stat = await fs.promises.stat(this.manifestPath);
      return stat.mtime;
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private _startWatcher(): void {
    if (this._watcher) {
      return;
    }
    // Watch the target directory rather than the file itself so we catch
    // creates (new manifest after dbt parse).
    const targetDir = path.dirname(this.manifestPath);
    try {
      this._watcher = fs.watch(targetDir, (_event, filename) => {
        if (filename === "manifest.json") {
          void this.reloadManifest();
        }
      });
    } catch {
      // target/ may not exist yet; watcher will simply not start.
    }
  }

  dispose(): void {
    this._watcher?.close();
    this._watcher = null;
    this._loadPromise = null;
    this._onManifestChanged.dispose();
  }
}

// ---------------------------------------------------------------------------
// Standalone helper — exported for use in tests without constructing a project
// ---------------------------------------------------------------------------

/**
 * Extracts the `name:` value from raw dbt_project.yml content.
 * Returns null if the name field is not found.
 */
export function extractProjectName(ymlContent: string): string | null {
  const match = /^name:\s*['"]?([^\s'"]+)/m.exec(ymlContent);
  return match ? match[1] : null;
}
