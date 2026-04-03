/**
 * ProjectDiscovery finds all dbt projects in the current VS Code workspace.
 * Projects are discovered via workspace.findFiles or an explicit setting.
 *
 * The vscode module is imported lazily inside discover() so that this module
 * can be loaded by unit tests without the VS Code runtime present. The pure
 * helper findProjectForFile() is exported for direct testing.
 */

import * as fs from "fs";
import * as path from "path";
import { DbtProject, extractProjectName } from "./project";

export class ProjectDiscovery {
  projects: DbtProject[] = [];

  /**
   * Discovers all dbt projects in the workspace.
   *
   * Uses dbtCoreTools.projectDirectories if set, otherwise scans for
   * dbt_project.yml files via workspace.findFiles. Filters out paths
   * under dbt_packages/ or dbt_modules/.
   */
  async discover(): Promise<DbtProject[]> {
    // Lazy-require vscode so this module can be loaded in unit tests.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const vscode = require("vscode") as typeof import("vscode");

    // Dispose any previously discovered projects.
    this.dispose();

    const config = vscode.workspace.getConfiguration("dbtCoreTools");
    const explicitDirs: string[] = config.get("projectDirectories") ?? [];

    let ymlPaths: string[];

    if (explicitDirs.length > 0) {
      // Resolve explicit directories relative to first workspace folder.
      const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
      ymlPaths = explicitDirs.map((d) =>
        path.join(
          path.isAbsolute(d) ? d : path.join(wsRoot, d),
          "dbt_project.yml",
        ),
      );
    } else {
      const uris = await vscode.workspace.findFiles(
        "**/dbt_project.yml",
        "{**/dbt_packages/**,**/dbt_modules/**}",
      );
      ymlPaths = uris.map((u) => u.fsPath);
    }

    // Filter out paths inside dbt_packages / dbt_modules (belt-and-suspenders).
    const sep = path.sep;
    const filtered = ymlPaths.filter(
      (p) =>
        !p.includes(`${sep}dbt_packages${sep}`) &&
        !p.includes(`${sep}dbt_modules${sep}`),
    );

    const projects: DbtProject[] = [];
    for (const ymlPath of filtered) {
      const name = await readProjectName(ymlPath);
      projects.push(new DbtProject(ymlPath, { name }));
    }

    this.projects = projects;
    return projects;
  }

  /**
   * Returns the project that most specifically contains filePath.
   * When multiple projects could match (nested projects), the one with
   * the longest root path wins.
   */
  findProjectForFile(filePath: string): DbtProject | null {
    return findProjectForFile(this.projects, filePath);
  }

  /** Disposes all discovered projects. */
  dispose(): void {
    for (const p of this.projects) {
      p.dispose();
    }
    this.projects = [];
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Returns the project with the longest root path that contains filePath.
 * Exported so tests can call it directly without VS Code APIs.
 */
export function findProjectForFile(
  projects: DbtProject[],
  filePath: string,
): DbtProject | null {
  let best: DbtProject | null = null;
  for (const project of projects) {
    if (project.containsFile(filePath)) {
      if (best === null || project.rootPath.length > best.rootPath.length) {
        best = project;
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function readProjectName(ymlPath: string): Promise<string> {
  try {
    const content = await fs.promises.readFile(ymlPath, "utf8");
    return extractProjectName(content) ?? path.basename(path.dirname(ymlPath));
  } catch {
    return path.basename(path.dirname(ymlPath));
  }
}
